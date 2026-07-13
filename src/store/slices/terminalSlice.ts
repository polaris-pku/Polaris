import type { DemoState, PendingRunIntent, SliceCreator, TerminalSlice } from '@/store/types';
import {
  disposeTerminal,
  listTerminalSessions,
  signalTerminal,
  startTerminalSession,
  terminalAvailable,
} from '@/lib/pythonTerminal';
import { getSelectedRuntimeId } from '@/lib/pythonRuntime';
import { writeTargetOf } from '@/store/lib/agentWrites';

/**
 * 终端 / Dock / 帮助域。
 *
 * 【硬红线 R3/I5】`startTerminalRun` / `startTerminalRepl` **只能由用户手势调用**：
 * 文件树的 ▶、文件页的「运行」、终端空态的「打开交互式 Python」、以及安装完成后消费一次
 * `pendingRunIntent`。**它们永远不能出现在任何 `backend:event` handler 的调用链里** ——
 * agent 会往工作区写 `.py`，任何「事件到了就跑点什么」的路径都是 agent → 宿主的静默 RCE。
 * （scripts/design-guard.mjs 的规则 16 把这条钉死成一条会失败的命令。）
 *
 * 依赖方向（不许成环）：
 *   RuntimeChannel → useDemoStore → terminalSlice → pythonRuntime
 *   pythonRuntime **不** import store。
 */

/** 运行意图的存活时长。超时即作废 —— 一个躺了半小时的「待运行」文件不再代表用户此刻的意图。 */
const INTENT_TTL_MS = 60_000;

/**
 * 用户按过「停止 / 中断」的会话。
 *
 * 为什么要在渲染层记一笔：`term:event` 的 `exit` 里只有 code / signal，
 * 分不出「进程自己退了」和「是我把它掐了」。而这两件事在状态行里必须说得不一样
 * （`✕ 已退出 · 代码 1` vs `■ 已终止`）。主进程的 `term:list` 里有权威的 status，
 * 重挂载后会把这里的推断覆盖掉 —— 这只是 exit 那一瞬间的桥。
 */
const killedByUser = new Set<string>();

/** 本地伪会话：主进程根本没起进程（启动就失败了），但用户必须看见失败原因。 */
const LOCAL_PREFIX = 'local:';
let localSeq = 0;

const isLocal = (sessionId: string) => sessionId.startsWith(LOCAL_PREFIX);
const baseNameOf = (relPath: string) => relPath.split(/[\\/]/).pop() || relPath;

function localErrorSession(title: string, runtimeId: string, error: string): TermSession {
  localSeq += 1;
  return {
    sessionId: `${LOCAL_PREFIX}${String(localSeq)}`,
    title,
    status: 'error',
    runtimeId,
    cwd: '',
    exitCode: null,
    durationMs: 0,
    replay: `${error}\n`,
  };
}

/** 活动会话没了就换一个（优先还在跑的那个）。 */
function pickActive(sessions: TermSession[], current: string | null): string | null {
  if (current && sessions.some((s) => s.sessionId === current)) return current;
  const running = [...sessions].reverse().find((s) => s.status === 'running');
  return running?.sessionId ?? sessions[sessions.length - 1]?.sessionId ?? null;
}

/**
 * `term:event` → store 的纯归约（由 useDemoStore 的模块级订阅调用）。
 *
 * **`data` chunk 不进 store** —— 它直接进 xterm（TerminalFrame 自己订阅）。
 * 一个 `while True: print('x')` 的输出量放进 zustand，会把整个渲染层拖死。
 * 这里只吸收会话状态的变化。
 */
export function reduceTermEvent(state: DemoState, event: TermEvent): Partial<DemoState> {
  if (event.kind === 'data' || event.kind === 'truncated') return {};

  const termSessions = state.termSessions.map((s) => {
    if (s.sessionId !== event.sessionId) return s;
    if (event.kind === 'exit') {
      const killed = killedByUser.has(s.sessionId);
      killedByUser.delete(s.sessionId);
      return {
        ...s,
        status: (killed ? 'killed' : 'exited') as TermSessionStatus,
        exitCode: event.code,
        durationMs: event.durationMs,
      };
    }
    return { ...s, status: 'error' as TermSessionStatus, replay: `${s.replay}${event.message}\n` };
  });

  return { termSessions };
}

export const createTerminalSlice: SliceCreator<TerminalSlice> = (set, get) => ({
  openDock: (dockChannel) => set({ dockOpen: true, dockChannel }),

  closeDock: () => {
    // 关掉 Dock = 用户不再打算跑那个文件了。意图令牌当场作废（I5：它只代表那一次点击）。
    set({ dockOpen: false, pendingRunIntent: null });
  },

  setDockChannel: (dockChannel) => set({ dockChannel }),

  openEvidence: (evidenceStepId) => set({ dockOpen: true, dockChannel: 'events', evidenceStepId }),

  openHelp: (topic) => set({ helpOpen: true, helpTopic: topic ?? null }),

  closeHelp: () => set({ helpOpen: false }),

  /**
   * 【R3/I5】只能由用户手势调用。
   *
   * 没有解释器时**不弹错误窗**：写下一次性运行意图 + 就地把 Dock 切到「运行时」频道。
   * 用户的意图是「跑这个文件」，不是「管理运行时」—— 安装是中途插入的一步，不是另一件事。
   * 装完由 RuntimeChannel 消费一次 pendingRunIntent，接着跑他本来要跑的那个文件。
   */
  startTerminalRun: async ({ projectName, rootPath, relPath }) => {
    if (!terminalAvailable()) {
      get().openDock('terminal'); // 浏览器里：频道自己会说「终端仅在桌面版可用」
      return;
    }

    const runtimeId = getSelectedRuntimeId();
    if (!runtimeId) {
      set({ pendingRunIntent: { projectName, rootPath, relPath, at: Date.now() } });
      get().openDock('runtimes');
      return;
    }

    get().openDock('terminal');
    const title = baseNameOf(relPath);
    const result = await startTerminalSession({
      projectName,
      rootPath,
      runtimeId,
      kind: 'script',
      path: relPath, // 项目内相对路径。绝对路径不在 API 里（I1）
      title,
    });

    if (!result.ok) {
      set((s) => ({
        termSessions: [...s.termSessions, localErrorSession(title, runtimeId, result.error)],
        pendingRunIntent: null,
      }));
      set((s) => ({ activeSessionId: pickActive(s.termSessions, null) }));
      return;
    }

    set({ pendingRunIntent: null });
    await get().syncTerminalSessions();
    set({ activeSessionId: result.sessionId });
  },

  /** 【R3/I5】只能由用户手势调用（终端空态的「打开交互式 Python」）。REPL = python -i -u。 */
  startTerminalRepl: async () => {
    if (!terminalAvailable()) {
      get().openDock('terminal');
      return;
    }

    const runtimeId = getSelectedRuntimeId();
    if (!runtimeId) {
      get().openDock('runtimes');
      return;
    }

    const state = get();
    const project = state.projects.find((p) => p.id === state.activeProjectId);
    // 与 agent 同根：agent 写哪 = 面板读哪 = 终端跑哪。
    const target = writeTargetOf(project);

    get().openDock('terminal');
    const result = await startTerminalSession({
      projectName: target.projectName,
      rootPath: target.rootPath,
      runtimeId,
      kind: 'repl',
      title: 'REPL',
    });

    if (!result.ok) {
      set((s) => ({
        termSessions: [...s.termSessions, localErrorSession('REPL', runtimeId, result.error)],
      }));
      set((s) => ({ activeSessionId: pickActive(s.termSessions, null) }));
      return;
    }

    await get().syncTerminalSessions();
    set({ activeSessionId: result.sessionId });
  },

  /** 消费一次运行意图（安装完成后接着跑）。超时的意图作废 —— 它只代表用户那一次点击。 */
  consumeRunIntent: (): PendingRunIntent | null => {
    const intent = get().pendingRunIntent;
    if (!intent) return null;
    set({ pendingRunIntent: null });
    if (Date.now() - intent.at > INTENT_TTL_MS) return null;
    return intent;
  },

  clearRunIntent: () => set({ pendingRunIntent: null }),

  /**
   * 从 `term:list` 重新水合会话（含每个会话的 ring buffer 回放）。
   *
   * `resetDemo()` 直接 `set(blankState())` —— `termSessions` 会被整个抹掉。这无害：
   * **子进程活在主进程里，不会变成孤儿**。TerminalChannel 挂载时调一次这个，界面就回来了。
   * 没有它，「重挂载后终端一片空白」会立刻复现。
   */
  syncTerminalSessions: async () => {
    const sessions = await listTerminalSessions();
    set((s) => {
      // 本地伪会话（启动就失败的那些）主进程不知道 —— 它们只活在渲染层，别被拉取覆盖掉。
      const locals = s.termSessions.filter((x) => isLocal(x.sessionId));
      const termSessions = [...sessions, ...locals];
      return { termSessions, activeSessionId: pickActive(termSessions, s.activeSessionId) };
    });
  },

  selectSession: (activeSessionId) => set({ activeSessionId }),

  closeSession: async (sessionId) => {
    if (!isLocal(sessionId)) await disposeTerminal(sessionId);
    killedByUser.delete(sessionId);
    set((s) => {
      const termSessions = s.termSessions.filter((x) => x.sessionId !== sessionId);
      return {
        termSessions,
        activeSessionId: pickActive(
          termSessions,
          s.activeSessionId === sessionId ? null : s.activeSessionId,
        ),
      };
    });
  },

  /**
   * 停止 / 中断。
   * POSIX：interrupt 是真 SIGINT（python 会打出 KeyboardInterrupt）。
   * Windows：没有真正的中断信号，一律 taskkill /T /F —— UI 上按钮因此叫「停止」（I11）。
   */
  signalSession: async (sessionId, signal) => {
    if (isLocal(sessionId)) return;
    killedByUser.add(sessionId);
    await signalTerminal(sessionId, signal);
  },
});

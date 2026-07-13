/**
 * 状态栏 —— 28px，AppShell 级，**跨页恒在**。
 *
 * ```
 * ● 执行中 · 1m04s      ▸ 终端            Python 3.13.14   ◈ 事件 19   帮助
 * └ 左：run 状态（打开 snake.py 也还在）  └ 右：解释器（点→运行时频道）  └ 通道 LED
 * ```
 *
 * 左段是**必留项**：用户的真实回路是「看着 agent → agent 写出 snake.py → 我打开它 →
 * 我跑它 → **它还在跑吗？**」。除了状态栏，这一刻没有任何地方还留着答案 ——
 * 运行屏的主句在你点开文件的那一秒就从屏幕上消失了。
 *
 * 它同时是原来那条 6 格遥测条的遗产清算：`STAGE` / `TASK` / `NODE` / `OWNER` 全是第 2–3 次
 * 重复，`SYSTEM NOMINAL` 是一个写死的常量字符串（军事仪表盘的皮，零信息内核）。
 * **六格里只有 `EVENTS` 那一格幸存** —— 因为只有它回答了一个别处没人回答的问题：
 * 界面不动，是没事发生，还是断了？
 *
 * `▸ 终端` 是 Dock 的把手（收起态）—— 一个元素两个职责，**零新增常驻像素**。
 *
 * 【R3/I5】这里只开关 Dock（纯状态），**永远不起进程**。终端会话只能由文件树的 ▶ /
 * 文件页的「运行」/ 终端空态的 REPL 起 —— 事件驱动的自动执行 = agent → 宿主的 RCE。
 */
import { useEffect, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { elapsedSince, formatElapsed, useNow } from '@/lib/elapsed';
import { pythonAvailable, selectedRuntime, usePythonState } from '@/lib/pythonRuntime';
import { RUN_STATE_LABEL, RUN_STATE_TONE, runStateOf } from '@/lib/runState';
import type { RunState } from '@/lib/runState';
import { cn } from '@/lib/utils';
import type { DemoState } from '@/store/types';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';
import type { EventChannelStatus } from '@/api/events';

const selectActiveTask = (s: DemoState) => s.tasks.find((t) => t.id === s.activeTaskId);

/** 语气从冻结的 `RUN_STATE_TONE` 里推出来 —— 那张表要是加了第五种色相，这里会当场编译不过。 */
type Tone = (typeof RUN_STATE_TONE)[RunState];

/** 颜色只编码状态。 */
const TONE_DOT: Record<Tone, string> = {
  muted: 'bg-fg-faint',
  command: 'bg-command',
  human: 'bg-human',
  ok: 'bg-ok',
  danger: 'bg-danger',
};

const TONE_TEXT: Record<Tone, string> = {
  muted: 'text-fg-muted',
  command: 'text-command',
  human: 'text-human',
  ok: 'text-ok',
  danger: 'text-danger',
};

/** 事件通道健康度。它回答的是那个没人问出口、却每次都想问的问题：界面不动，是没事发生，还是断了？ */
const CHANNEL: Record<EventChannelStatus, { dot: string; text: string }> = {
  connected: { dot: 'bg-command', text: '事件通道已连接' },
  connecting: { dot: 'bg-human', text: '正在连接事件通道' },
  disconnected: { dot: 'bg-danger', text: '事件通道已断开（界面收不到新事件）' },
};

export function StatusBar() {
  const task = useDemoStore(selectActiveTask);
  // 必须走 selectActiveLiveRun：直接读 liveRuns 再自己比对 runId 的写法已经出过事 ——
  // 并发跑第二个需求时，会把另一次 run 的状态安在当前任务头上。
  const live = useDemoStore(selectActiveLiveRun);
  const channel = useDemoStore((s) => s.eventChannelStatus);
  const eventCount = useDemoStore((s) => s.backendEvents.length);
  const dockOpen = useDemoStore((s) => s.dockOpen);
  const openDock = useDemoStore((s) => s.openDock);
  const closeDock = useDemoStore((s) => s.closeDock);
  const openHelp = useDemoStore((s) => s.openHelp);

  const state = runStateOf(task, live);
  const tone = RUN_STATE_TONE[state];

  // 秒表只在 run 还活着时走。终态之后每秒重渲染一次状态栏是白烧电。
  const ticking = state === 'running' || state === 'blocked';
  const now = useNow(1000, ticking);
  // run 的**总用时**。主句给的是**当前这一步**的用时 —— 两条不同的事实，各有各的宿主（R1）。
  const startedAt = live?.timeline[0]?.created_at;
  const elapsed = ticking && startedAt ? formatElapsed(elapsedSince(startedAt, now)) : null;

  const python = usePythonState();
  const runtime = selectedRuntime(python);
  const hasPython = pythonAvailable();

  // Ctrl+` / ⌘` —— 用户手势，合法。它只开关 Dock，不起任何进程。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '`' || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (dockOpen) closeDock();
      else openDock('terminal');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [dockOpen, openDock, closeDock]);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-edge bg-surface-deck px-2">
      {/* 左段：run 状态。打开 snake.py 之后，全屏只剩它还知道 agent 有没有跑完。 */}
      <span className="flex items-center gap-2 px-2" title={`当前需求：${task?.title ?? '—'}`}>
        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
        <span className={cn('text-body', TONE_TEXT[tone])}>{RUN_STATE_LABEL[state]}</span>
        {elapsed && <span className="tabular text-meta text-fg-muted">· {elapsed}</span>}
      </span>

      {/* Dock 的把手。一个元素两个职责，零新增常驻像素。 */}
      <StatusItem
        onClick={() => {
          if (dockOpen) closeDock();
          else openDock('terminal');
        }}
        title="终端 / 事件流 / 运行时（Ctrl+`）"
      >
        {dockOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
        )}
        终端
      </StatusItem>

      <span className="flex-1" />

      {/* 当前解释器。浏览器里没有解释器可选，这一格就不该存在（不做假的降级）。 */}
      {hasPython && (
        <StatusItem
          onClick={() => {
            openDock('runtimes');
          }}
          title={
            runtime
              ? `当前解释器：${runtime.displayPath}`
              : '还没有选定解释器 —— 点击选择或安装一个'
          }
        >
          {runtime ? (
            <span className="tabular">Python {runtime.version}</span>
          ) : (
            <span className="text-fg-muted">Python · 未选择</span>
          )}
        </StatusItem>
      )}

      {/* 通道 LED + 已收到的事件条数。原遥测条 6 格里唯一不重复的那一格，幸存至此。 */}
      <StatusItem
        onClick={() => {
          openDock('events');
        }}
        title={`${CHANNEL[channel].text} · 观测窗口内 ${String(eventCount)} 条`}
      >
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', CHANNEL[channel].dot)}
        />
        事件
        <span className="tabular text-meta text-fg-muted">{eventCount}</span>
      </StatusItem>

      <StatusItem
        onClick={() => {
          openHelp();
        }}
        title="打开帮助"
      >
        帮助
      </StatusItem>
    </footer>
  );
}

/** 状态栏的一格：可点、安静、不抢戏。 */
function StatusItem({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-chip px-2 py-0.5 text-body text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg-primary"
    >
      {children}
    </button>
  );
}

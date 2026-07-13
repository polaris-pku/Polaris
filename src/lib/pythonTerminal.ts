/**
 * 终端 IPC 的薄封装（`window.desktop.terminal` → 渲染层）。
 *
 * 【硬红线 R3/I5】`start` 只能由用户手势触发（文件树的 ▶ / 文件页的「运行」/ 终端空态的 REPL /
 * 安装完成后消费 pendingRunIntent）。**它永远不能出现在任何 `backend:event` handler 的调用链里** ——
 * agent 会往工作区写 `.py`，任何「事件到了就跑点什么」的路径都是 agent → 宿主的静默 RCE。
 *
 * 这一层只做转发与形状收敛：
 * - **没有绝对路径入参**（I1）：只给项目内相对路径，越界校验在主进程。
 * - **没有 argv 入参**（I4）：命令行由主进程构造。
 * - **没有解释器路径入参**（I2）：只给不透明的 runtimeId。
 */

/** 一次 stdin 写入的上限（I13）。xterm 只是渲染器：原样字节转发，不解析、不执行。 */
export const TERM_WRITE_MAX = 8 * 1024;

function bridge() {
  return typeof window === 'undefined' ? undefined : window.desktop?.terminal;
}

/** 桌面壳里才有终端。浏览器里 UI 换成一句「终端仅在桌面版可用」，**不做假的降级**。 */
export function terminalAvailable(): boolean {
  return bridge() != null;
}

/** 当前平台（决定「中断」还是「停止」—— Windows 上没有真正的中断信号，I11）。 */
export function terminalPlatform(): NodeJS.Platform {
  return typeof window === 'undefined' ? 'linux' : (window.desktop?.platform ?? 'linux');
}

/**
 * 新建一个终端会话。**只能由用户手势调用。**
 * 主进程会：resolveProjectRoot + isInside 校验路径 → 白名单查解释器 → spawn(shell:false)。
 */
export async function startTerminalSession(
  req: DesktopTermStartPayload,
): Promise<DesktopTermStartResult> {
  const terminal = bridge();
  if (!terminal) return { ok: false, error: '终端仅在桌面版可用' };
  return terminal.start(req);
}

/** 往 stdin 写原样字节（≤ 8KB/次）。`input()` 与 REPL 就靠这条。 */
export async function writeTerminal(
  sessionId: string,
  data: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const terminal = bridge();
  if (!terminal) return { ok: false, error: '终端仅在桌面版可用' };
  return terminal.write(sessionId, data.slice(0, TERM_WRITE_MAX));
}

/**
 * 中断 / 终止。
 * POSIX：`interrupt` 按进程组发 SIGINT，python 真的会打出 `KeyboardInterrupt`。
 * Windows：**没有真正的中断信号**，两种手势都走 taskkill /T /F —— 所以 UI 上按钮必须叫「停止」。
 */
export async function signalTerminal(
  sessionId: string,
  signal: 'interrupt' | 'kill',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const terminal = bridge();
  if (!terminal) return { ok: false, error: '终端仅在桌面版可用' };
  return terminal.signal(sessionId, signal);
}

/** 关闭并清理会话（进程按进程组杀，不会留孤儿）。 */
export async function disposeTerminal(sessionId: string): Promise<void> {
  const terminal = bridge();
  if (!terminal) return;
  await terminal.dispose(sessionId);
}

/**
 * 拉取会话快照（含每个会话的 ring buffer 回放）。
 *
 * 挂载时必须调一次：`resetDemo()` 会把 `termSessions` 抹掉，但**子进程活在主进程里**，
 * 不会变成孤儿。没有这次水合，「重挂载后终端一片空白」会立刻复现。
 */
export async function listTerminalSessions(): Promise<TermSession[]> {
  const terminal = bridge();
  if (!terminal) return [];
  const result = await terminal.list();
  return result.sessions;
}

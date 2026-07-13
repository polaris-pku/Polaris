/**
 * 终端状态行的纯函数（退出码 → 文案 + 色）。
 *
 * 为什么单独成文件：这段文案是**诚实性的落点**。Windows 上 Node 的 SIGINT 是假的
 * （映射成 TerminateProcess），所以那里没有「中断」这回事 —— python 不会打出
 * `KeyboardInterrupt`。**我们不假装两个平台一致**：Windows 上按钮叫「停止」、页脚说「已终止」；
 * POSIX 上按钮叫「中断」、页脚说「已中断」。这是 pipe 方案（不引 node-pty）的已知代价，
 * 明码标价地写在界面上，而不是藏起来。
 */

/** 只用四个强调色 + 一个中性色。终端不许自己发明色相。 */
export type StatusTone = 'command' | 'ok' | 'danger' | 'human' | 'muted';

export type TerminalStatusInput = {
  status: TermSessionStatus;
  exitCode: number | null;
  /** 运行中传「到现在为止」，终态传最终耗时 */
  durationMs: number;
  /** 输出超过单会话上限，主进程已停止转发（I9） */
  truncated?: boolean;
  errorMessage?: string;
  platform: NodeJS.Platform;
};

export type TerminalStatus = { text: string; tone: StatusTone };

/**
 * 耗时文案：`0.6s` / `42.1s` / `1m12s`。
 *
 * 有意不复用 `lib/elapsed.ts`（那是主句的秒表，格式与取数口径都由 run 的 span 决定）——
 * 终端的耗时来自主进程的 durationMs，两者只是碰巧长得像。焊在一起会让任一方的改动误伤另一方。
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return s === 60 ? `${String(m + 1)}m0s` : `${String(m)}m${String(s)}s`;
}

/** Windows 上没有真正的中断信号 —— 按钮就该叫「停止」。 */
export function stopButtonLabel(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '停止' : '中断';
}

/** hover 时把代价说清楚（帮助文档 › 已知限制里有同一句）。 */
export function stopButtonTitle(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? 'Windows 上没有真正的中断信号，会直接终止进程（不会打印 KeyboardInterrupt）。'
    : '发送 SIGINT，python 会打印 KeyboardInterrupt。';
}

/** 主进程发的 signal 语义：POSIX 的 interrupt 是真 SIGINT；Windows 一律是终止。 */
export function stopSignalOf(platform: NodeJS.Platform): 'interrupt' | 'kill' {
  return platform === 'win32' ? 'kill' : 'interrupt';
}

export function terminalStatusLine(input: TerminalStatusInput): TerminalStatus {
  const { status, exitCode, durationMs, truncated, errorMessage, platform } = input;
  const used = formatDuration(durationMs);

  if (status === 'error') {
    return { text: `✕ 启动失败 · ${errorMessage || '未知原因'}`, tone: 'danger' };
  }

  // 还在跑但输出已经超量：此刻用户唯一需要知道的就是「还在跑，但我不再往上抛了」。
  if (truncated && status === 'running') {
    return { text: '⚠ 输出过多，已截断（保留最后 2000 行）', tone: 'human' };
  }

  const suffix = truncated ? ' · 输出已截断' : '';

  if (status === 'running') {
    return { text: `● 运行中 · ${used}`, tone: 'command' };
  }

  if (status === 'killed') {
    // POSIX 是真的被中断了（python 打出了 KeyboardInterrupt）；Windows 是被直接终止。
    return platform === 'win32'
      ? { text: `■ 已终止 · 用时 ${used}${suffix}`, tone: 'muted' }
      : { text: `● 已中断 · 用时 ${used}${suffix}`, tone: 'muted' };
  }

  if (exitCode === 0) {
    return { text: `✓ 已退出 · 代码 0 · 用时 ${used}${suffix}`, tone: 'ok' };
  }
  return {
    text: `✕ 已退出 · 代码 ${exitCode == null ? '—' : String(exitCode)} · 用时 ${used}${suffix}`,
    tone: 'danger',
  };
}

/** 状态行的文字色（四色 + 中性）。 */
export const TONE_TEXT: Record<StatusTone, string> = {
  command: 'text-command',
  ok: 'text-ok',
  danger: 'text-danger',
  human: 'text-human',
  muted: 'text-fg-muted',
};

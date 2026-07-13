import { useEffect, useRef, useState } from 'react';
import { TONE_TEXT, terminalStatusLine } from '@/lib/terminalExit';
import { cn } from '@/lib/utils';

/**
 * 终端下方的 24px 状态行。
 *
 * 它只回答一件事：**这东西还在跑吗，跑完是成是败。** 运行中每 100ms 跳一次 ——
 * 这是「活着」在屏幕上的第二个证据（第一个是主句）。
 *
 * 秒表在渲染层自己算：主进程只在 `term:list` 里给一次 `durationMs` 基线，
 * 不会为了一个秒表每 100ms 发一条 IPC。
 */
export function TerminalStatusLine({
  session,
  truncated,
  platform,
}: {
  session: TermSession;
  truncated: boolean;
  platform: NodeJS.Platform;
}) {
  const running = session.status === 'running';

  // 会话切换时重取基线（durationMs 是主进程给的「到现在为止跑了多久」）。
  const baseline = useRef({ sessionId: session.sessionId, at: Date.now() - session.durationMs });
  if (baseline.current.sessionId !== session.sessionId) {
    baseline.current = { sessionId: session.sessionId, at: Date.now() - session.durationMs };
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [running, session.sessionId]);

  const { text, tone } = terminalStatusLine({
    status: session.status,
    exitCode: session.exitCode,
    durationMs: running ? now - baseline.current.at : session.durationMs,
    truncated,
    errorMessage: session.status === 'error' ? session.replay.trim() : undefined,
    platform,
  });

  return (
    <div className="flex h-6 shrink-0 items-center justify-between gap-4 border-t border-edge bg-surface-deck px-3">
      <span className={cn('truncate text-body tabular', TONE_TEXT[tone])}>{text}</span>
      {session.cwd && (
        <span className="truncate font-mono text-code text-fg-faint" title={session.cwd}>
          {session.cwd}
        </span>
      )}
    </div>
  );
}

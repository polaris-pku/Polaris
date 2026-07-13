import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { onTerminalEvent } from '@/api/terminal';
import { writeTerminal } from '@/lib/pythonTerminal';
import {
  XTERM_FONT_FAMILY,
  XTERM_FONT_SIZE,
  XTERM_LINE_HEIGHT,
  XTERM_SCROLLBACK,
  XTERM_THEME,
} from '@/lib/xtermTheme';

/**
 * 一个会话的 xterm 画面。
 *
 * 【I13】xterm 只是渲染器，不是能力：`onData` 只原样转发字节到 `term:write`，
 * **不解析、不执行**。stdin 通着 —— 所以 `input()` 能用、REPL（`python -i -u`）能用。
 *
 * 输出 chunk **不进 zustand**：直接订阅 `term:event` 写进 xterm。
 * （一个 `while True: print('x')` 的输出量放进 store 会把整个渲染层拖死。主进程侧已经做了
 * 16ms 批量 flush + 单包 64KB + 单会话 5MB 上限 + 2000 行 ring buffer。）
 */
export function TerminalFrame({
  session,
  onTruncated,
}: {
  session: TermSession;
  onTruncated: (sessionId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 回调放 ref 里：它变了不该把整个终端重建一遍（会清屏）。
  const truncatedRef = useRef(onTruncated);
  truncatedRef.current = onTruncated;

  const sessionId = session.sessionId;
  const replay = session.replay;
  // 首帧回放只在会话切换时取一次 —— 之后的字节走事件流，重复灌会把屏幕写两遍。
  const replayRef = useRef(replay);
  replayRef.current = replay;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily: XTERM_FONT_FAMILY,
      fontSize: XTERM_FONT_SIZE,
      lineHeight: XTERM_LINE_HEIGHT,
      scrollback: XTERM_SCROLLBACK,
      // python 走管道输出的是 \n（没有 PTY 就没有行规），不转换的话每一行都往右阶梯式缩进。
      convertEol: true,
      cursorBlink: true,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // 重挂载水合：主进程 ring buffer 里的最后 2000 行。没有这句，切个 tab 回来就是一片空白。
    if (replayRef.current) term.write(replayRef.current);

    const dispose = term.onData((data) => {
      void writeTerminal(sessionId, data);
    });

    const unsubscribe = onTerminalEvent((event) => {
      if (event.sessionId !== sessionId) return;
      if (event.kind === 'data') term.write(event.chunk);
      else if (event.kind === 'truncated') truncatedRef.current(sessionId);
      else if (event.kind === 'error') term.write(`\r\n${event.message}\r\n`);
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* 容器还没量出尺寸（Dock 正在展开）—— 下一帧会再来一次 */
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      unsubscribe();
      dispose.dispose();
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={hostRef} className="h-full w-full bg-surface-void px-2 py-1" />;
}

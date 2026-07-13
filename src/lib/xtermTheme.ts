/**
 * xterm 主题 —— **必须从设计 token 派生**，否则终端会成为界面上的第 12 个色相。
 *
 * 免费的一致性：Python 的 traceback 是红的 → `danger`；pytest 的 `.` 是绿的 → `ok`。
 * 终端的颜色语义与应用的颜色语义天然对齐 —— 只要我们不另起一套色板。
 *
 * 强调色只有 4 个（command / human / ok / danger），所以 ANSI 的 magenta 并进 human、
 * cyan 并进 command。**不新增色相。**
 */

/** tailwind.config.js 里的同名 token（这里只能是字面量：xterm 吃的是十六进制，不是 class）。 */
const SURFACE_VOID = '#090b10';
const FG_PRIMARY = '#e2e8f0';
const FG_SECONDARY = '#94a3b8';
const FG_FAINT = '#475569';
const EDGE = '#1e2636';
const COMMAND = '#4d8df0';
const HUMAN = '#ffb454';
const OK = '#34d399';
const DANGER = '#fb7185';

export const XTERM_THEME = {
  background: SURFACE_VOID,
  foreground: FG_PRIMARY,
  cursor: COMMAND,
  cursorAccent: SURFACE_VOID,
  selectionBackground: 'rgba(77,141,240,0.25)',
  black: EDGE,
  brightBlack: FG_FAINT,
  red: DANGER,
  brightRed: DANGER,
  green: OK,
  brightGreen: OK,
  yellow: HUMAN,
  brightYellow: HUMAN,
  blue: COMMAND,
  brightBlue: COMMAND,
  magenta: HUMAN,
  brightMagenta: HUMAN,
  cyan: COMMAND,
  brightCyan: COMMAND,
  white: FG_SECONDARY,
  brightWhite: FG_PRIMARY,
} as const;

/** 等宽栈与 index.css 的 --font-mono 同源（含中文落点，否则日志里一出现中文列就崩）。 */
export const XTERM_FONT_FAMILY =
  '"JetBrains Mono", "Cascadia Mono", "Sarasa Mono SC", Consolas, "SF Mono", Menlo, "Microsoft YaHei UI", monospace';

/** 与 text-code（12/20）同一档 —— 终端不许自己发明字号。 */
export const XTERM_FONT_SIZE = 12;
export const XTERM_LINE_HEIGHT = 1.5;

/** 渲染层滚回缓冲：与主进程 ring buffer 的 2000 行对齐。 */
export const XTERM_SCROLLBACK = 2000;

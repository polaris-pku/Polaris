/**
 * 终端事件通道 —— 订阅主进程推来的 `term:event`。
 *
 * 形状与 ./events.ts 完全同构（模块级 Set<Handler> + 幂等 attach）：
 * **推送通道每 namespace 只有一个**，靠 payload 里的 `sessionId` 分流 ——
 * 与 `backend:notification` 靠 `run_id` 分流是同一个道理。绝不为每个会话开一条 `term:data:<id>`：
 * preload 的取消订阅是按通道 removeListener 的，多通道必然泄漏 listener。
 *
 * 两类消费者：
 * - `TerminalFrame`：只要自己那个 session 的 `data` chunk，直接喂进 xterm（**不进 store** ——
 *   一个 while True: print('x') 的输出量放进 zustand 会把整个渲染层拖死）。
 * - store 的模块级订阅：只吸收 `exit` / `error`，把会话状态如实落到 `termSessions`。
 */

export type TermEventHandler = (event: TermEvent) => void;

const handlers = new Set<TermEventHandler>();
let attached = false;
let detach: (() => void) | null = null;

/** 桌面壳里才有终端（浏览器里 window.desktop 为 undefined）。 */
function bridge() {
  return typeof window === 'undefined' ? undefined : window.desktop?.terminal;
}

function attach() {
  if (attached) return;
  const terminal = bridge();
  if (!terminal) return; // 非桌面环境：不做假的降级，UI 那边会说「终端仅在桌面版可用」
  attached = true;
  detach = terminal.onEvent((event) => {
    handlers.forEach((h) => h(event));
  });
}

/** 订阅终端事件。返回退订函数。 */
export function onTerminalEvent(handler: TermEventHandler): () => void {
  attach();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** 测试用：清空模块级状态（订阅集 + 挂载标记）。 */
export function resetTerminalChannel(): void {
  handlers.clear();
  if (detach) detach();
  detach = null;
  attached = false;
}

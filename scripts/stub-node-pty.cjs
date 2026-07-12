/**
 * node-pty 的桩。
 *
 * A（acp-client）的 `client/builder.ts` **静态 import** 了 `PtyConnection`，所以只要加载 A，
 * node-pty 就一定会被 require —— 哪怕我们走的是纯 ACP 路径、一次也用不到它。
 *
 * node-pty 是原生模块：打包要 electron-rebuild、要 asarUnpack、要每个平台单独编译。
 * 为了一个从不执行的 import 付这个代价没有意义。
 *
 * 所以打包时把它替换成这个桩：加载不报错，真去用（只有 aider 这类 PTY agent 才会）时明确报错。
 * 我们只支持 ACP 协议的 agent（claude / gemini / codex …），它们全都走 stdio，不碰 PTY。
 */
function unavailable() {
  throw new Error(
    'PTY 不可用：打包版只支持 ACP 协议的 agent（claude / gemini / codex 等，全部走 stdio）。' +
      'aider 这类需要 PTY 的 agent 未随包提供。',
  );
}

module.exports = {
  spawn: unavailable,
  open: unavailable,
};

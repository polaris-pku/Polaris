/**
 * 后端接入配置。
 *
 * BCD 没有 HTTP 服务 —— 它只暴露 stdio 上的行分隔 JSON-RPC，由 Electron 主进程
 * 拉起并转成 IPC。所以这里不再有 baseUrl / wsUrl，只剩「走哪条传输」。
 * 选路逻辑在 ./transport.ts：桌面壳里有 `window.desktop.backend` 就走真实 IPC，否则 mock。
 */
export const apiConfig = {
  /** 强制走 mock（无 API key / 演示兜底时用）。桌面壳之外始终是 mock。 */
  forceMock: import.meta.env.VITE_USE_MOCK === 'true',
};

/** 当前是否跑在 mock 上（即没有真实后端）。 */
export function isMockMode(): boolean {
  if (apiConfig.forceMock) return true;
  return typeof window === 'undefined' || !window.desktop?.backend;
}

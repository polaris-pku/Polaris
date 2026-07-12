/**
 * 后端传输层 —— 前端与 BCD 之间唯一的物理通道。
 *
 * BCD 只暴露 stdio 上的行分隔 JSON-RPC，没有 HTTP 服务。桌面壳里由 Electron 主进程
 * （electron/backendBridge.cjs）拉起 BCD 并把方法/事件转成 IPC，渲染层通过
 * `window.desktop.backend` 调用；浏览器里没有这座桥，回落到 mock。
 *
 * ── 扩展位（重要）──
 * 当前 BCD 只能「创建」和「取消」，**没有任何人类回写通道**：
 * Council 由 agent 角色自己裁决，Gate 也不接受人类决策。
 * 将来 BCD 补上 `council.submitVerdict` / `gate.submitDecision` 之类的方法时，
 * 只需在这里的 `RunTransport` 加方法、在 client.ts 加一个薄封装，
 * **UI 层与 store 一行都不用改** —— map.ts 里 UI→契约的裁决映射已经写好了。
 */
import type {
  PingResult,
  RunCreateParams,
  RunCreateResult,
  RunEvent,
  RunSnapshot,
} from './types/rpc';

export type BackendState = 'stopped' | 'starting' | 'ready' | 'error';

export interface BackendStatus {
  state: BackendState;
  message: string;
}

export interface RunTransport {
  readonly kind: 'ipc' | 'mock';
  ping(): Promise<PingResult>;
  createRun(params: RunCreateParams): Promise<RunCreateResult>;
  getSnapshot(runId: string): Promise<RunSnapshot>;
  subscribe(runId: string): Promise<void>;
  unsubscribe(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  /** 订阅后端推来的 run.event；返回退订函数。 */
  onEvent(handler: (event: RunEvent) => void): () => void;
  /** 订阅后端进程状态；返回退订函数。 */
  onStatus(handler: (status: BackendStatus) => void): () => void;
  getStatus(): Promise<BackendStatus>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

// ── IPC 传输（Electron 桌面壳）──

function createIpcTransport(bridge: NonNullable<DesktopBridge['backend']>): RunTransport {
  async function call<T>(method: string, params?: unknown): Promise<T> {
    const res = await bridge.call(method, params);
    if (!res.ok) throw new BackendError(res.error, res.code);
    return res.result as T;
  }

  return {
    kind: 'ipc',
    ping: () => call<PingResult>('system.ping'),
    createRun: (params) => call<RunCreateResult>('run.create', params),
    getSnapshot: (runId) => call<RunSnapshot>('run.getSnapshot', { run_id: runId }),
    subscribe: async (runId) => {
      await call('run.subscribe', { run_id: runId });
    },
    unsubscribe: async (runId) => {
      await call('run.unsubscribe', { run_id: runId });
    },
    cancel: async (runId) => {
      await call('run.cancel', { run_id: runId });
    },
    onEvent: (handler) => bridge.onEvent((payload) => handler(payload.event as RunEvent)),
    onStatus: (handler) => bridge.onStatus(handler),
    getStatus: () => bridge.getStatus(),
  };
}

// ── Mock 传输（浏览器 / 无后端）──
//
// 不发任何请求，本地伪造一个与后端受理行为同形的结果，让调用方走完全相同的代码路径。
// 真实剧本推进仍由 store 里的 mock 状态机负责，这里只提供协议层的同形应答。

function createMockTransport(): RunTransport {
  const eventHandlers = new Set<(event: RunEvent) => void>();
  let seq = 0;

  return {
    kind: 'mock',
    ping: async () => ({ status: 'ok', protocol_version: 'mock' }),
    createRun: async (params) => {
      const id = Date.now().toString(36);
      const runId = `run-mock-${id}`;
      const taskId = `task-mock-${id}`;
      // 后端受理即 emit task.created；mock 同形复现，让消费链路在无后端时也真实走通。
      queueMicrotask(() => {
        const event: RunEvent = {
          event_id: `evt-${taskId}`,
          sequence: ++seq,
          run_id: runId,
          task_id: taskId,
          type: 'task.created',
          source: 'coordinator',
          created_at: new Date().toISOString(),
          payload: { spec: params.prompt },
          schema_version: 'mock',
        };
        eventHandlers.forEach((h) => h(event));
      });
      return { run_id: runId, task_id: taskId, status: 'running' };
    },
    getSnapshot: () => Promise.reject(new BackendError('mock 模式没有后端快照')),
    subscribe: async () => {},
    unsubscribe: async () => {},
    cancel: async () => {},
    onEvent: (handler) => {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    onStatus: (handler) => {
      queueMicrotask(() => handler({ state: 'ready', message: 'mock' }));
      return () => {};
    },
    getStatus: async () => ({ state: 'ready', message: 'mock' }),
  };
}

// ── 选路 ──

let cached: RunTransport | null = null;

/**
 * 选传输：桌面壳里有 `window.desktop.backend` 就走真实 IPC；否则 mock。
 * `VITE_USE_MOCK=true` 可强制 mock（无 API key / 演示兜底时用）。
 */
export function getTransport(): RunTransport {
  if (cached) return cached;
  const forceMock = import.meta.env.VITE_USE_MOCK === 'true';
  const bridge = typeof window !== 'undefined' ? window.desktop?.backend : undefined;
  cached = !forceMock && bridge ? createIpcTransport(bridge) : createMockTransport();
  return cached;
}

/** 测试用：重置选路缓存。 */
export function resetTransport() {
  cached = null;
}

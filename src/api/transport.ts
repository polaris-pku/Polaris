import type { RpcMethod, RpcNotification, RpcParams, RpcResult } from './types/rpc';
import { RPC_METHOD_SET } from './rpcMethods';

export type BackendState = 'stopped' | 'starting' | 'ready' | 'error';

export interface BackendAgent {
  id: string;
  name: string;
}

export interface BackendProvider {
  id: string;
  name: string;
  keyLabel: string;
  keyHint: string;
  consoleUrl: string;
  consoleName: string;
  baseUrl: string;
  editableBaseUrl: boolean;
  defaultModel: string;
  defaultFastModel: string;
}

export interface BackendAuth {
  providerId: string;
  hasKey: boolean;
  incomplete: boolean;
  hasLocalCredentials: boolean;
  ready: boolean;
  baseUrl: string;
  model: string;
  fastModel: string;
}

export interface BackendStatus {
  state: BackendState;
  message: string;
  workspace: string;
  auth: BackendAuth;
  agents: BackendAgent[];
  providers: BackendProvider[];
}

export interface BackendTransport {
  readonly kind: 'ipc' | 'web' | 'unavailable';
  call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>>;
  onNotification(handler: (notification: RpcNotification) => void): () => void;
  onStatus(handler: (status: BackendStatus) => void): () => void;
  getStatus(): Promise<BackendStatus>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly method?: RpcMethod,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

function isNotification(value: unknown): value is RpcNotification {
  if (!value || typeof value !== 'object') return false;
  const method = Reflect.get(value, 'method');
  const params = Reflect.get(value, 'params');
  return (
    (method === 'task.event' || method === 'run.event') && !!params && typeof params === 'object'
  );
}

function createIpcTransport(bridge: NonNullable<DesktopBridge['backend']>): BackendTransport {
  return {
    kind: 'ipc',
    async call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
      if (!RPC_METHOD_SET.has(method)) throw new BackendError(`未知 RPC 方法：${method}`, method);
      const response = await bridge.call(method, params);
      if (!response.ok) {
        throw new BackendError(response.error, method, response.code, response.data);
      }
      return response.result as RpcResult<M>;
    },
    onNotification: (handler) =>
      bridge.onNotification((notification) => {
        if (isNotification(notification)) handler(notification);
      }),
    onStatus: (handler) => bridge.onStatus(handler),
    getStatus: () => bridge.getStatus(),
  };
}

function createWebTransport(baseUrl: string): BackendTransport {
  let nextId = 1;
  const endpoint = baseUrl.replace(/\/$/, '');

  return {
    kind: 'web',
    async call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
      if (!RPC_METHOD_SET.has(method)) throw new BackendError(`未知 RPC 方法：${method}`, method);
      const response = await fetch(`${endpoint}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
      });
      if (!response.ok) {
        throw new BackendError(`Web backend HTTP ${response.status}`, method);
      }
      const envelope = (await response.json()) as {
        result?: RpcResult<M>;
        error?: { code: number; message: string; data?: unknown };
      };
      if (envelope.error) {
        throw new BackendError(
          envelope.error.message,
          method,
          envelope.error.code,
          envelope.error.data,
        );
      }
      return envelope.result as RpcResult<M>;
    },
    onNotification(handler) {
      const events = new EventSource(`${endpoint}/events`);
      events.onmessage = (event) => {
        try {
          const notification: unknown = JSON.parse(event.data);
          if (isNotification(notification)) handler(notification);
        } catch {
          // A malformed event is ignored; the connection remains usable.
        }
      };
      return () => events.close();
    },
    onStatus(handler) {
      let active = true;
      void this.getStatus().then((status) => {
        if (active) handler(status);
      });
      return () => {
        active = false;
      };
    },
    async getStatus() {
      try {
        await this.call('system.ping', {});
        return webStatus('ready', 'Web bridge connected');
      } catch (error) {
        return webStatus('error', error instanceof Error ? error.message : String(error));
      }
    },
  };
}

function webStatus(state: BackendState, message: string): BackendStatus {
  return {
    state,
    message,
    workspace: '',
    auth: {
      providerId: 'web',
      hasKey: false,
      incomplete: false,
      hasLocalCredentials: false,
      ready: state === 'ready',
      baseUrl: '',
      model: '',
      fastModel: '',
    },
    agents: [],
    providers: [],
  };
}

const UNAVAILABLE_STATUS: BackendStatus = {
  state: 'error',
  message: '未连接 Electron 后端或 Web bridge。',
  workspace: '',
  auth: {
    providerId: '',
    hasKey: false,
    incomplete: false,
    hasLocalCredentials: false,
    ready: false,
    baseUrl: '',
    model: '',
    fastModel: '',
  },
  agents: [],
  providers: [],
};

function createUnavailableTransport(): BackendTransport {
  return {
    kind: 'unavailable',
    call(method) {
      return Promise.reject(new BackendError(UNAVAILABLE_STATUS.message, method));
    },
    onNotification() {
      return () => undefined;
    },
    onStatus(handler) {
      queueMicrotask(() => handler(UNAVAILABLE_STATUS));
      return () => undefined;
    },
    getStatus: async () => UNAVAILABLE_STATUS,
  };
}

let cached: BackendTransport | null = null;

export function getTransport(): BackendTransport {
  if (cached) return cached;
  const bridge = typeof window !== 'undefined' ? window.desktop?.backend : undefined;
  const webUrl = import.meta.env.VITE_BACKEND_WEB_URL?.trim();
  cached = bridge
    ? createIpcTransport(bridge)
    : webUrl
      ? createWebTransport(webUrl)
      : createUnavailableTransport();
  return cached;
}

export function setTransportForTests(transport: BackendTransport | null): void {
  cached = transport;
}

export function resetTransport(): void {
  cached = null;
}

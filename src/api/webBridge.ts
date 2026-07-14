const BASE_URL = 'http://127.0.0.1:4318';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || `本机桥请求失败：${response.status}`);
  return value;
}

function browserPlatform(): NodeJS.Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('win')) return 'win32';
  return 'linux';
}

export async function installLocalWebBridge(): Promise<boolean> {
  if (window.desktop || !import.meta.env.DEV) return false;
  try {
    await request<{ ok: true }>('/health');
  } catch {
    return false;
  }

  const eventHandlers = new Set<(payload: { run_id: string; event: unknown }) => void>();
  const statusHandlers = new Set<(status: DesktopBackendStatus) => void>();
  const events = new EventSource(`${BASE_URL}/events`);
  events.onmessage = (message) => {
    const envelope = JSON.parse(message.data) as { type: string; payload: unknown };
    if (envelope.type === 'run.event') {
      eventHandlers.forEach((handler) =>
        handler(envelope.payload as { run_id: string; event: unknown }),
      );
    }
    if (envelope.type === 'backend.status') {
      statusHandlers.forEach((handler) => handler(envelope.payload as DesktopBackendStatus));
    }
  };

  window.desktop = {
    isDesktop: true,
    platform: browserPlatform(),
    versions: { electron: 'web', chrome: navigator.userAgent, node: 'local-bridge' },
    fs: {
      writeTextFile: (payload) => request('/fs/write', payload),
      readTextFile: (payload) => request('/fs/read', payload),
      chooseDirectory: async (options) => {
        const value = window.prompt(
          `${options?.title || '选择文件夹'}\n请输入本机绝对目录路径：`,
          '/Users/neighhhbor/Desktop/SEKE_Projects/newIDE/BCD/testresult',
        );
        return value?.trim() ? request('/fs/authorize', { path: value.trim() }) : null;
      },
      readDirectoryTree: (rootPath) => request('/fs/tree', { rootPath }),
      reveal: async (absPath) => {
        await request('/fs/reveal', { path: absPath });
      },
    },
    backend: {
      call: (method, params) => request('/backend/call', { method, params }),
      getStatus: () => request('/backend/status'),
      configure: (options) => request('/backend/configure', options),
      restart: () => request('/backend/restart', {}),
      getSettings: () => request('/backend/settings'),
      saveSettings: () => request('/backend/restart', {}),
      onEvent: (handler) => {
        eventHandlers.add(handler);
        return () => eventHandlers.delete(handler);
      },
      onStatus: (handler) => {
        statusHandlers.add(handler);
        return () => statusHandlers.delete(handler);
      },
    },
    updates: {
      onEvent: () => () => {},
      getState: async () => null,
      download: async () => {},
      openDownloadPage: async () => {},
      restart: async () => {},
      check: async () => {},
    },
  };
  return true;
}

/**
 * 事件通道的订阅语义。
 *
 * 钉死一个真实出过的 bug：`watchRun` 曾经只维护一个 `subscribedRunId`，
 * 订阅新 run 之前会**先把上一个退订**。于是并发提交第二个需求时，第一个 run
 * 在后端照常跑到底，前端却再也收不到它的事件 —— 界面上表现为第一个任务永远卡住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getWatchedRunIds, resetEventChannel, unwatchRun, watchRun } from './events';
import { resetTransport } from './transport';

const READY_STATUS = {
  state: 'ready' as const,
  message: '',
  workspace: '/tmp/ws',
  auth: {
    providerId: 'anthropic',
    hasKey: true,
    incomplete: false,
    hasLocalCredentials: false,
    ready: true,
    baseUrl: '',
    model: '',
    fastModel: '',
  },
  agents: [],
  providers: [],
};

/** 假的桌面桥，形状与 electron/preload.cjs 暴露的 window.desktop.backend 一致。 */
function installFakeBackend() {
  const rpc: Array<{ method: string; params: unknown }> = [];
  const backend = {
    call: vi.fn(async (method: string, params: unknown) => {
      rpc.push({ method, params });
      return { ok: true as const, result: {} };
    }),
    getStatus: vi.fn(async () => READY_STATUS),
    configure: vi.fn(async () => READY_STATUS),
    restart: vi.fn(async () => READY_STATUS),
    getSettings: vi.fn(async () => ({ provider: 'anthropic', configured: {} })),
    saveSettings: vi.fn(async () => READY_STATUS),
    onEvent: vi.fn(() => () => {}),
    onStatus: vi.fn(() => () => {}),
  };
  vi.stubGlobal('window', { desktop: { isDesktop: true, platform: 'linux', backend } });
  return {
    calls: (method: string) => rpc.filter((c) => c.method === method),
  };
}

describe('watchRun', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTransport();
    resetEventChannel();
  });

  it('订阅第二个 run 时，绝不退订第一个（并发需求的命门）', async () => {
    const fake = installFakeBackend();

    await watchRun('run-1');
    await watchRun('run-2');

    expect(getWatchedRunIds()).toEqual(['run-1', 'run-2']);
    expect(fake.calls('run.subscribe').map((c) => c.params)).toEqual([
      { run_id: 'run-1' },
      { run_id: 'run-2' },
    ]);
    // 关键断言：第一个 run 的订阅必须原封不动地留着。
    expect(fake.calls('run.unsubscribe')).toHaveLength(0);
  });

  it('重复 watch 同一个 run 不会重复订阅', async () => {
    const fake = installFakeBackend();

    await watchRun('run-1');
    await watchRun('run-1');

    expect(fake.calls('run.subscribe')).toHaveLength(1);
    expect(getWatchedRunIds()).toEqual(['run-1']);
  });

  it('订阅失败不会把 run 留在订阅集里（否则重试会被当成已订阅而永远收不到事件）', async () => {
    const rpc: string[] = [];
    const backend = {
      call: vi.fn(async (method: string) => {
        rpc.push(method);
        if (method === 'run.subscribe' && rpc.filter((m) => m === 'run.subscribe').length === 1) {
          return { ok: false as const, error: '后端还没起来' };
        }
        return { ok: true as const, result: {} };
      }),
      getStatus: vi.fn(async () => READY_STATUS),
      configure: vi.fn(async () => READY_STATUS),
      restart: vi.fn(async () => READY_STATUS),
      getSettings: vi.fn(async () => ({ provider: 'anthropic', configured: {} })),
      saveSettings: vi.fn(async () => READY_STATUS),
      onEvent: vi.fn(() => () => {}),
      onStatus: vi.fn(() => () => {}),
    };
    vi.stubGlobal('window', { desktop: { isDesktop: true, platform: 'linux', backend } });

    await expect(watchRun('run-1')).rejects.toThrow();
    expect(getWatchedRunIds()).toEqual([]);

    // 重试必须真的重新发一次 run.subscribe
    await watchRun('run-1');
    expect(getWatchedRunIds()).toEqual(['run-1']);
    expect(rpc.filter((m) => m === 'run.subscribe')).toHaveLength(2);
  });

  it('unwatchRun 只退订指定的那个 run，其余照常关注', async () => {
    const fake = installFakeBackend();

    await watchRun('run-1');
    await watchRun('run-2');
    await unwatchRun('run-1');

    expect(getWatchedRunIds()).toEqual(['run-2']);
    expect(fake.calls('run.unsubscribe').map((c) => c.params)).toEqual([{ run_id: 'run-1' }]);
  });
});

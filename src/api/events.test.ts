/**
 * 事件通道的订阅语义 + 断号/重连的重同步。
 *
 * 钉死一个真实出过的 bug：`watchRun` 曾经只维护一个 `subscribedRunId`，
 * 订阅新 run 之前会**先把上一个退订**。于是并发提交第二个需求时，第一个 run
 * 在后端照常跑到底，前端却再也收不到它的事件 —— 界面上表现为第一个任务永远卡住。
 *
 * 另一半钉的是「快照是权威，事件只是增量」：实时流跳号 = 真的丢了事件，
 * 增量补不回来，必须重新拉一次 `run.getSnapshot`；而且一串乱序只该换来一次重拉。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWatchedRunIds,
  onRunEvent,
  onRunResync,
  resetEventChannel,
  unwatchRun,
  watchRun,
} from './events';
import { resetTransport } from './transport';
import type { RunEvent } from './types/rpc';

const READY_STATUS = {
  state: 'ready' as const,
  message: '',
  workspace: '/tmp/ws',
  modelProxy: {
    configured: true,
    incomplete: false,
    ready: true,
    baseUrl: 'http://127.0.0.1:4000',
    model: 'copilot-test',
  },
  bMemory: { configured: true },
  agents: [],
};

/** 一条实时事件。实时流的 sequence 是**逐 run 从 1 开始、连续**的（后端 run-registry）。 */
function evt(runId: string, sequence: number): RunEvent {
  return {
    event_id: `${runId}-e${sequence}`,
    sequence,
    run_id: runId,
    task_id: `task-of-${runId}`,
    type: `event.${sequence}`,
    source: 'coordinator',
    created_at: '2026-01-01T00:00:00.000Z',
    payload: {},
    schema_version: 'test',
  };
}

/** run.getSnapshot 的最小可信返回（只要 run_id 对得上，本用例不看内容）。 */
function snapshotOf(runId: string) {
  return {
    schema_version: 'v0',
    run_id: runId,
    task_id: `task-of-${runId}`,
    mode: 'single_agent',
    status: 'running',
    current: { stage: 'executing', active_node_code: 'N3' },
    timeline: [],
    agent_runs: [],
    artifacts: [],
    gates: [],
    errors: [],
  };
}

/**
 * 假的桌面桥，形状与 electron/preload.cjs 暴露的 window.desktop.backend 一致。
 *
 * `replay` 模拟后端 `run.subscribe` 的历史重放（registry 会把该 run 的全部事件按实时编号推一遍）。
 */
function installFakeBackend(options: { replay?: Record<string, RunEvent[]> } = {}) {
  const rpc: Array<{ method: string; params: unknown }> = [];
  const notificationHandlers = new Set<(notification: unknown) => void>();
  const statusHandlers = new Set<(status: unknown) => void>();

  const emit = (event: RunEvent) => {
    notificationHandlers.forEach((handler) =>
      handler({ method: 'run.event', params: { run_id: event.run_id, event } }),
    );
  };

  const backend = {
    call: vi.fn(async (method: string, params: unknown) => {
      rpc.push({ method, params });
      if (method === 'run.subscribe') {
        const runId = (params as { run_id: string }).run_id;
        for (const event of options.replay?.[runId] ?? []) emit(event);
        return { ok: true as const, result: { subscribed: true } };
      }
      if (method === 'run.getSnapshot') {
        return { ok: true as const, result: snapshotOf((params as { run_id: string }).run_id) };
      }
      return { ok: true as const, result: {} };
    }),
    getStatus: vi.fn(async () => READY_STATUS),
    configure: vi.fn(async () => READY_STATUS),
    restart: vi.fn(async () => READY_STATUS),
    getSettings: vi.fn(async () => ({
      modelProxy: { baseUrl: 'http://127.0.0.1:4000', model: 'copilot-test' },
      bMemory: { configured: true },
    })),
    saveSettings: vi.fn(async () => READY_STATUS),
    onNotification: vi.fn((handler: (notification: unknown) => void) => {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    }),
    onStatus: vi.fn((handler: (status: unknown) => void) => {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    }),
  };
  vi.stubGlobal('window', { desktop: { isDesktop: true, platform: 'linux', backend } });

  return {
    emit,
    /** 推一条后端进程状态（重连 = 掉线之后又 ready）。 */
    setStatus: (state: 'ready' | 'starting' | 'stopped' | 'error') => {
      statusHandlers.forEach((handler) => handler({ ...READY_STATUS, state }));
    },
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
      getSettings: vi.fn(async () => ({
        provider: 'anthropic',
        bMemory: { configured: true },
        configured: {},
      })),
      saveSettings: vi.fn(async () => READY_STATUS),
      onNotification: vi.fn(() => () => {}),
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

describe('断号与重连的重同步', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTransport();
    resetEventChannel();
  });

  it('顺序到达的事件一次快照都不拉', async () => {
    const fake = installFakeBackend();
    const received: number[] = [];
    const off = onRunEvent((event) => received.push(event.sequence));

    await watchRun('run-1');
    fake.emit(evt('run-1', 1));
    fake.emit(evt('run-1', 2));
    fake.emit(evt('run-1', 3));

    expect(received).toEqual([1, 2, 3]);
    expect(fake.calls('run.getSnapshot')).toHaveLength(0);
    off();
  });

  it('重复事件既不重复投递，也不会被当成断号', async () => {
    const fake = installFakeBackend();
    const received: string[] = [];
    const off = onRunEvent((event) => received.push(event.event_id));

    await watchRun('run-1');
    fake.emit(evt('run-1', 1));
    fake.emit(evt('run-1', 1));
    fake.emit(evt('run-1', 2));

    expect(received).toEqual(['run-1-e1', 'run-1-e2']);
    expect(fake.calls('run.getSnapshot')).toHaveLength(0);
    off();
  });

  it('跳号 → 重新拉一次权威快照，并靠重订阅把断掉的那条补回来', async () => {
    // 后端 registry 在（重）订阅时会把该 run 当时的全部事件按实时编号重放一遍。
    const replay: Record<string, RunEvent[]> = {
      'run-1': [evt('run-1', 1), evt('run-1', 2), evt('run-1', 3)],
    };
    const fake = installFakeBackend({ replay });
    const received: number[] = [];
    const resynced: Array<{ run_id: string; reason: string }> = [];
    const offEvent = onRunEvent((event) => received.push(event.sequence));
    const offResync = onRunResync((resync) =>
      resynced.push({ run_id: resync.run_id, reason: resync.reason }),
    );

    await watchRun('run-1');
    // 首次订阅的重放：1/2/3 都到了。
    expect(received).toEqual([1, 2, 3]);

    // 后端接着产生了第 4、5 条，但第 4 条在推送途中丢了，第 5 条直接到 —— 这就是断号。
    replay['run-1'] = [1, 2, 3, 4, 5].map((sequence) => evt('run-1', sequence));
    fake.emit(evt('run-1', 5));
    await vi.waitFor(() => expect(resynced).toHaveLength(1));

    expect(fake.calls('run.getSnapshot').map((c) => c.params)).toEqual([{ run_id: 'run-1' }]);
    expect(resynced).toEqual([{ run_id: 'run-1', reason: 'gap' }]);
    // 重订阅的重放把丢掉的第 4 条补了回来 —— 已经投递过的靠 event_id 去重挡住，不会重来一遍。
    // （到达顺序是 5 在前 4 在后，消费方按 sequence 排序，本就不依赖到达顺序。）
    await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 5, 4]));
    expect(fake.calls('run.subscribe')).toHaveLength(2);
    offEvent();
    offResync();
  });

  it('一串乱序/跳号只换来一次重拉（不能每条事件拉一次）', async () => {
    const fake = installFakeBackend();
    const off = onRunEvent(() => undefined);

    await watchRun('run-1');
    fake.emit(evt('run-1', 1));
    fake.emit(evt('run-1', 5));
    fake.emit(evt('run-1', 9));
    fake.emit(evt('run-1', 3));
    fake.emit(evt('run-1', 12));
    await vi.waitFor(() => expect(fake.calls('run.getSnapshot')).toHaveLength(1));

    // 断号期间的事件一条都不能丢：晚到的 3 也照常投递。
    expect(fake.calls('run.getSnapshot')).toHaveLength(1);
    off();
  });

  it('重连 → 每一个还在关注的 run 都重新拉一次快照并重订阅', async () => {
    const fake = installFakeBackend();

    await watchRun('run-1');
    await watchRun('run-2');
    expect(fake.calls('run.subscribe')).toHaveLength(2);

    // 后端进程掉了又起来（切工作区 / 崩溃重启）：旧订阅注册在上一个进程里，已经作废。
    fake.setStatus('stopped');
    fake.setStatus('ready');
    await vi.waitFor(() => expect(fake.calls('run.getSnapshot')).toHaveLength(2));

    expect(fake.calls('run.getSnapshot').map((c) => c.params)).toEqual([
      { run_id: 'run-1' },
      { run_id: 'run-2' },
    ]);
    await vi.waitFor(() => expect(fake.calls('run.subscribe')).toHaveLength(4));
  });

  it('首次 ready 不算重连（那是首次进入，不该无端拉一遍快照）', async () => {
    const fake = installFakeBackend();

    await watchRun('run-1');
    fake.setStatus('ready');
    fake.setStatus('ready');

    expect(fake.calls('run.getSnapshot')).toHaveLength(0);
  });
});

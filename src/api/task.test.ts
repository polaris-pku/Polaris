/**
 * task 事件流：订阅顺序、断号重同步、重连重订阅。
 *
 * 「快照是权威，事件只是增量」在 task 通道上的落点就是 `task.subscribe`：
 * 它一次给回 `TaskSnapshot` + 全量重放事件，断号和重连都靠再走一次它来覆盖本地状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRunEvent, resetEventChannel } from './events';
import { taskApi, unwatchAllTasks, watchTask } from './task';
import { resetTransport } from './transport';
import type { RunEvent } from './types/rpc';
import type { TaskSnapshot } from './types/task';

const snapshot: TaskSnapshot = {
  contract_version: 'task-snapshot.v0',
  schema_version: 'test',
  revision: 1,
  task: {
    task_id: 'task-1',
    status: 'running',
    risk_level: 'medium',
    spec: 'Test replay ordering',
    completion_criteria: ['Events stay ordered'],
    affected_paths: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    schema_version: 'test',
  },
  run_history: [],
  warnings: [],
};

const READY_STATUS = {
  state: 'ready' as const,
  message: '',
  workspace: '/tmp/ws',
  auth: {
    providerId: 'anthropic',
    hasKey: true,
    hasLocalCredentials: false,
    incomplete: false,
    ready: true,
    baseUrl: '',
    model: 'test-model',
    fastModel: 'test-model',
  },
  agents: [],
  providers: [],
};

function event(id: string, sequence: number, taskId = 'task-1', runId = 'run-1'): RunEvent {
  return {
    event_id: id,
    sequence,
    task_id: taskId,
    run_id: runId,
    type: `event.${sequence}`,
    source: 'coordinator',
    created_at: '2026-01-01T00:00:00.000Z',
    payload: {},
    schema_version: 'test',
  };
}

function snapshotOf(taskId: string): TaskSnapshot {
  return { ...snapshot, task: { ...snapshot.task, task_id: taskId } };
}

/** 可编程的假桌面桥（形状对齐 electron/preload.cjs 的 window.desktop.backend）。 */
function installFakeBackend(
  options: {
    replay?: Record<string, RunEvent[]>;
    snapshots?: Record<string, TaskSnapshot>;
  } = {},
) {
  const rpc: Array<{ method: string; params: unknown }> = [];
  const notificationHandlers = new Set<(notification: unknown) => void>();
  const statusHandlers = new Set<(status: unknown) => void>();

  const emit = (taskId: string, value: RunEvent) => {
    notificationHandlers.forEach((handler) =>
      handler({ method: 'task.event', params: { task_id: taskId, event: value } }),
    );
  };

  const backend = {
    call: vi.fn(
      async (
        method: string,
        params: unknown,
      ): Promise<{ ok: true; result: unknown } | { ok: false; error: string; code: number }> => {
        rpc.push({ method, params });
        if (method === 'task.get') {
          const taskId = (params as { task_id: string }).task_id;
          return { ok: true as const, result: options.snapshots?.[taskId] ?? snapshotOf(taskId) };
        }
        if (method === 'task.subscribe') {
          const taskId = (params as { task_id: string }).task_id;
          return {
            ok: true as const,
            result: {
              subscribed: true,
              snapshot: options.snapshots?.[taskId] ?? snapshotOf(taskId),
              replay_events: options.replay?.[taskId] ?? [],
            },
          };
        }
        return { ok: true as const, result: { unsubscribed: true } };
      },
    ),
    onNotification: vi.fn((handler: (notification: unknown) => void) => {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    }),
    onStatus: vi.fn((handler: (status: unknown) => void) => {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    }),
    getStatus: vi.fn(async () => READY_STATUS),
    configure: vi.fn(async () => READY_STATUS),
    restart: vi.fn(async () => READY_STATUS),
    getSettings: vi.fn(async () => ({ bMemory: { configured: true } })),
    saveSettings: vi.fn(async () => READY_STATUS),
  };
  vi.stubGlobal('window', { desktop: { isDesktop: true, platform: 'linux', backend } });

  return {
    backend,
    emit,
    setStatus: (state: 'ready' | 'starting' | 'stopped' | 'error') => {
      statusHandlers.forEach((handler) => handler({ ...READY_STATUS, state }));
    },
    calls: (method: string) => rpc.filter((c) => c.method === method),
  };
}

describe('watchTask', () => {
  beforeEach(async () => {
    await unwatchAllTasks();
    resetTransport();
    resetEventChannel();
    vi.unstubAllGlobals();
  });
  afterEach(async () => {
    await unwatchAllTasks();
    vi.useRealTimers();
  });

  it('sends only task_id when stopping recoverably, without calling cancel', async () => {
    const fake = installFakeBackend();
    await taskApi.interrupt('task-1');
    expect(fake.calls('task.interrupt')).toEqual([
      { method: 'task.interrupt', params: { task_id: 'task-1' } },
    ]);
    expect(fake.calls('task.cancel')).toHaveLength(0);
  });

  it('removes the previous server subscription before installing a replacement watcher', async () => {
    const fake = installFakeBackend();
    const first = await watchTask('task-1', { onSnapshot() {}, onEvent() {} });
    await watchTask('task-1', { onSnapshot() {}, onEvent() {} });
    const methods = fake.backend.call.mock.calls.map(([method]) => method);
    expect(methods).toEqual(['task.subscribe', 'task.unsubscribe', 'task.subscribe']);
    await first();
    expect(fake.calls('task.unsubscribe')).toHaveLength(1);
  });

  it('recovers an expired cursor by subscribing without it, never by rerunning', async () => {
    const fake = installFakeBackend();
    fake.backend.call.mockResolvedValueOnce({
      ok: false,
      error: 'cursor expired',
      code: -32009,
    });
    await watchTask('task-1', { onSnapshot() {}, onEvent() {} }, 'expired');
    expect(fake.backend.call.mock.calls.slice(0, 2)).toEqual([
      ['task.subscribe', { task_id: 'task-1', after_event_id: 'expired' }],
      ['task.subscribe', { task_id: 'task-1' }],
    ]);
  });

  it('deduplicates Task replay and live events at the shared Run projection boundary', async () => {
    const shared = event('shared', 1);
    const fake = installFakeBackend({ replay: { 'task-1': [shared] } });
    const received: string[] = [];
    const stop = onRunEvent((value) => received.push(value.event_id));
    await watchTask('task-1', { onSnapshot() {}, onEvent() {} });
    fake.emit('task-1', shared);
    expect(received).toEqual(['shared']);
    stop();
  });

  it('buffers reconnect events until the new authoritative snapshot and replay are applied', async () => {
    const fake = installFakeBackend();
    const order: string[] = [];
    await watchTask('task-1', {
      onSnapshot: (value) => order.push(`snapshot-${value.revision}`),
      onEvent: (value) => order.push(value.event_id),
    });
    let resolve!: (value: { ok: true; result: unknown }) => void;
    fake.backend.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fake.setStatus('starting');
    fake.setStatus('ready');
    fake.emit('task-1', event('new-live', 2));
    expect(order).toEqual(['snapshot-1']);
    resolve({
      ok: true,
      result: {
        subscribed: true,
        snapshot: { ...snapshot, revision: 2 },
        replay_events: [event('new-replay', 1), event('new-live', 2)],
      },
    });
    await vi.waitFor(() =>
      expect(order).toEqual(['snapshot-1', 'snapshot-2', 'new-replay', 'new-live']),
    );
  });

  it('cleans up a watcher whose initial subscription is still pending', async () => {
    const fake = installFakeBackend();
    let resolve!: (value: { ok: true; result: unknown }) => void;
    fake.backend.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const starting = watchTask('task-1', { onSnapshot() {}, onEvent() {} });
    await vi.waitFor(() =>
      expect(fake.backend.call).toHaveBeenCalledWith('task.subscribe', { task_id: 'task-1' }),
    );
    const cleanup = unwatchAllTasks();
    resolve({ ok: true, result: { subscribed: true, snapshot, replay_events: [] } });
    await Promise.all([starting, cleanup]);
    expect(fake.calls('task.unsubscribe')).toHaveLength(1);
  });

  it('ignores an old connection reply even when it has a larger revision', async () => {
    const fake = installFakeBackend();
    const observed: number[] = [];
    await watchTask('task-1', {
      onSnapshot: (value) => observed.push(value.revision),
      onEvent() {},
    });
    let resolve!: (value: { ok: true; result: TaskSnapshot }) => void;
    fake.backend.call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fake.emit('task-1', { ...event('trigger', 1), type: 'run.interrupted' });
    fake.setStatus('starting');
    fake.setStatus('ready');
    await vi.waitFor(() => expect(fake.calls('task.subscribe')).toHaveLength(2));
    resolve({ ok: true, result: { ...snapshot, revision: 999 } });
    await Promise.resolve();
    expect(observed).not.toContain(999);
  });

  it('refreshes a waiting Task even without events and stops polling only at Task completion', async () => {
    vi.useFakeTimers();
    const snapshots = {
      'task-1': { ...snapshot, task: { ...snapshot.task, status: 'waiting_help' } },
    };
    const fake = installFakeBackend({ snapshots });
    const observed: TaskSnapshot[] = [];
    await watchTask('task-1', { onSnapshot: (value) => observed.push(value), onEvent: () => {} });
    snapshots['task-1'] = {
      ...snapshot,
      revision: 2,
      task: { ...snapshot.task, status: 'completed' },
    };
    await vi.advanceTimersByTimeAsync(2000);
    expect(observed.map((item) => item.task.status)).toEqual(['waiting_help', 'completed']);
    expect(fake.calls('task.get')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(fake.calls('task.get')).toHaveLength(1);
  });

  it('a continuation Run refreshes task identity without waiting for a gap or reconnect', async () => {
    const snapshots = { 'task-1': snapshot };
    const fake = installFakeBackend({ snapshots });
    const observed: TaskSnapshot[] = [];
    await watchTask('task-1', { onSnapshot: (value) => observed.push(value), onEvent: () => {} });
    snapshots['task-1'] = {
      ...snapshot,
      revision: 2,
      current_run: {
        run_id: 'continuation',
        task_id: 'task-1',
        status: 'running',
        mode: 'council',
        restartable: false,
      },
    };
    fake.emit('task-1', {
      ...event('continued', 1, 'task-1', 'continuation'),
      type: 'run.started',
    });
    await vi.waitFor(() =>
      expect(observed[observed.length - 1]?.current_run?.run_id).toBe('continuation'),
    );
    expect(fake.calls('task.get')).toHaveLength(1);
    expect(fake.calls('task.subscribe')).toHaveLength(1);
  });

  it('does not let an older Task snapshot rewind the current Run', async () => {
    const snapshots = { 'task-1': { ...snapshot, revision: 3 } };
    const fake = installFakeBackend({ snapshots });
    const observed: TaskSnapshot[] = [];
    await watchTask('task-1', { onSnapshot: (value) => observed.push(value), onEvent: () => {} });
    snapshots['task-1'] = { ...snapshot, revision: 2 };
    fake.emit('task-1', { ...event('late', 1), type: 'run.completed' });
    await vi.waitFor(() => expect(fake.calls('task.get')).toHaveLength(1));
    expect(observed.map((item) => item.revision)).toEqual([3]);
  });

  it('applies snapshot, replay, then buffered live events', async () => {
    let notification: ((value: unknown) => void) | undefined;
    const applied: string[] = [];
    const backend = {
      call: vi.fn(async (method: string) => {
        if (method === 'task.subscribe') {
          notification?.({
            method: 'task.event',
            params: { task_id: 'task-1', event: event('live', 3) },
          });
          return {
            ok: true as const,
            result: { subscribed: true, snapshot, replay_events: [event('replay', 2)] },
          };
        }
        return { ok: true as const, result: { unsubscribed: true } };
      }),
      onNotification: vi.fn((handler: (value: unknown) => void) => {
        notification = handler;
        return () => undefined;
      }),
      onStatus: vi.fn(() => () => undefined),
      getStatus: vi.fn(async () => READY_STATUS),
      configure: vi.fn(),
      restart: vi.fn(),
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
    };
    vi.stubGlobal('window', { desktop: { isDesktop: true, platform: 'linux', backend } });

    await watchTask('task-1', {
      onSnapshot: () => applied.push('snapshot'),
      onEvent: (value) => applied.push(value.event_id),
    });

    expect(applied).toEqual(['snapshot', 'replay', 'live']);
  });

  it('顺序流与重复事件都不会触发重订阅', async () => {
    const fake = installFakeBackend();
    const applied: string[] = [];

    await watchTask('task-1', {
      onSnapshot: () => applied.push('snapshot'),
      onEvent: (value) => applied.push(value.event_id),
    });
    fake.emit('task-1', event('e1', 1));
    fake.emit('task-1', event('e2', 2));
    fake.emit('task-1', event('e2', 2));

    expect(applied).toEqual(['snapshot', 'e1', 'e2']);
    expect(fake.calls('task.subscribe')).toHaveLength(1);
  });

  it('跳号 → 重新走一次 task.subscribe：快照覆盖 + 重放补齐，且一串跳号只重拉一次', async () => {
    // 实时流的 sequence 逐 run 连续（后端 run-registry），所以 1 之后直接来 3 = 真的丢了第 2 条。
    const replay: Record<string, RunEvent[]> = { 'task-1': [] };
    const fake = installFakeBackend({ replay });
    const applied: string[] = [];

    await watchTask('task-1', {
      onSnapshot: () => applied.push('snapshot'),
      onEvent: (value) => applied.push(value.event_id),
    });
    fake.emit('task-1', event('e1', 1));

    replay['task-1'] = [event('e1', 1), event('e2', 2), event('e3', 3)];
    fake.emit('task-1', event('e3', 3));
    fake.emit('task-1', event('e5', 5));

    await vi.waitFor(() => expect(applied).toContain('e2'));
    // 重同步期间的 e5 缓存到快照与重放之后；e1/e3 按 event_id 去重。
    expect(applied).toEqual(['snapshot', 'e1', 'e3', 'snapshot', 'e2', 'e5']);
    expect(fake.calls('task.subscribe')).toHaveLength(2);
  });

  it('重连 → 每一个还在关注的 task 都重新订阅一次（旧订阅注册在上一个后端进程里）', async () => {
    const fake = installFakeBackend();
    const snapshots: string[] = [];

    await watchTask('task-1', {
      onSnapshot: (value) => snapshots.push(value.task.task_id),
      onEvent: () => undefined,
    });
    await watchTask('task-2', {
      onSnapshot: (value) => snapshots.push(value.task.task_id),
      onEvent: () => undefined,
    });
    expect(fake.calls('task.subscribe')).toHaveLength(2);

    fake.setStatus('stopped');
    fake.setStatus('ready');

    await vi.waitFor(() => expect(snapshots).toHaveLength(4));
    expect(snapshots).toEqual(['task-1', 'task-2', 'task-1', 'task-2']);
    expect(fake.calls('task.subscribe')).toHaveLength(4);
  });

  it('退订之后重连不再重订阅它', async () => {
    const fake = installFakeBackend();

    const dispose = await watchTask('task-1', {
      onSnapshot: () => undefined,
      onEvent: () => undefined,
    });
    await dispose();

    fake.setStatus('stopped');
    fake.setStatus('ready');
    await vi.waitFor(() => expect(fake.calls('task.unsubscribe')).toHaveLength(1));

    expect(fake.calls('task.subscribe')).toHaveLength(1);
  });
});

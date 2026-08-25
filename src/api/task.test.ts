/**
 * task 事件流：订阅顺序、断号重同步、重连重订阅。
 *
 * 「快照是权威，事件只是增量」在 task 通道上的落点就是 `task.subscribe`：
 * 它一次给回 `TaskSnapshot` + 全量重放事件，断号和重连都靠再走一次它来覆盖本地状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEventChannel } from './events';
import { unwatchAllTasks, watchTask } from './task';
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
function installFakeBackend(options: { replay?: Record<string, RunEvent[]> } = {}) {
  const rpc: Array<{ method: string; params: unknown }> = [];
  const notificationHandlers = new Set<(notification: unknown) => void>();
  const statusHandlers = new Set<(status: unknown) => void>();

  const emit = (taskId: string, value: RunEvent) => {
    notificationHandlers.forEach((handler) =>
      handler({ method: 'task.event', params: { task_id: taskId, event: value } }),
    );
  };

  const backend = {
    call: vi.fn(async (method: string, params: unknown) => {
      rpc.push({ method, params });
      if (method === 'task.subscribe') {
        const taskId = (params as { task_id: string }).task_id;
        return {
          ok: true as const,
          result: {
            subscribed: true,
            snapshot: snapshotOf(taskId),
            replay_events: options.replay?.[taskId] ?? [],
          },
        };
      }
      return { ok: true as const, result: { unsubscribed: true } };
    }),
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
      getStatus: vi.fn(),
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
    // 快照重新覆盖了一次，断掉的 e2 也补了回来；已投递过的 e1/e3 靠 event_id 去重挡住。
    expect(applied).toEqual(['snapshot', 'e1', 'e3', 'e5', 'snapshot', 'e2']);
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

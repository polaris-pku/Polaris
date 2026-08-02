import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchTask } from './task';
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

function event(id: string, sequence: number): RunEvent {
  return {
    event_id: id,
    sequence,
    task_id: 'task-1',
    run_id: 'run-1',
    type: `event.${sequence}`,
    source: 'coordinator',
    created_at: '2026-01-01T00:00:00.000Z',
    payload: {},
    schema_version: 'test',
  };
}

describe('watchTask', () => {
  beforeEach(() => {
    resetTransport();
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
});

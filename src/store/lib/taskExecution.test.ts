import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { resetEventChannel } from '@/api/events';
import { resetTransport } from '@/api/transport';
import type { TaskSnapshot } from '@/api/types/task';
import { createRequirementTask } from '@/data/tasks';
import type { DemoState } from '@/store/types';
import { useDemoStore } from '@/store/useDemoStore';
import { changeTaskExecution } from './taskExecution';
import { applyTaskSnapshot } from './taskObservation';

function snapshot(status: 'running' | 'blocked' | 'completed', revision = 1): TaskSnapshot {
  const run = {
    run_id: status === 'running' && revision > 1 ? 'resumed-run' : 'old-run',
    task_id: 'backend-task',
    status: status === 'blocked' ? ('interrupted' as const) : status,
    mode: 'single_agent' as const,
    restartable: false,
  };
  return {
    contract_version: 'task-snapshot.v0',
    schema_version: '0.1.0',
    revision,
    task: {
      task_id: 'backend-task',
      status,
      spec: 'Preserve the same task',
      completion_criteria: ['Native session continuity'],
      affected_paths: [],
      risk_level: 'low',
      created_at: '2026-10-13T00:00:00Z',
      updated_at: '2026-10-13T00:00:00Z',
      schema_version: '0.1.0',
    },
    ...(status === 'running' ? { current_run: run } : {}),
    run_history: [run],
    warnings: [],
  };
}

function fixture(initial: TaskSnapshot) {
  const call = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'task.get') return { ok: true, result: initial };
    if (method === 'task.interrupt') return { ok: true, result: snapshot('blocked', 2) };
    if (method === 'task.resume') return { ok: true, result: snapshot('running', 2) };
    if (method === 'run.getSnapshot')
      return {
        ok: true,
        result: {
          schema_version: '0.1.0',
          run_id: 'resumed-run',
          task_id: 'backend-task',
          mode: 'single_agent',
          status: 'running',
          current: { stage: 'executing', active_node_code: 'N7' },
          timeline: [],
          agent_runs: [],
          artifacts: [],
          gates: [],
          errors: [],
        },
      };
    return { ok: true, result: {} };
  });
  vi.stubGlobal('window', {
    desktop: {
      backend: {
        call,
        getStatus: async () => ({ state: 'ready' }),
        onStatus: () => () => {},
        onNotification: () => () => {},
      },
    },
  });
  resetTransport();
  resetEventChannel();
  const task = {
    ...createRequirementTask('local-task', 'project', 'Preserve the same task'),
    contractTaskId: 'backend-task',
    contractRunId: 'old-run',
  };
  const store = createStore<DemoState>()(() => ({
    ...useDemoStore.getInitialState(),
    tasks: [task],
    liveTasks: { 'backend-task': { snapshot: initial, events: [], status: 'live' } },
    liveRuns: {
      'old-run': {
        runId: 'old-run',
        taskId: 'backend-task',
        status: initial.run_history[0].status,
        timeline: [],
        snapshot: null,
        error: null,
      },
    },
  }));
  const action = (name: 'interrupt' | 'resume') =>
    changeTaskExecution('local-task', name, store.getState, store.setState);
  return { call, store, action };
}

afterEach(() => {
  resetEventChannel();
  resetTransport();
  vi.unstubAllGlobals();
});

describe('recoverable task actions', () => {
  it('interrupts without cancel, preserves task identity and adopts the blocked snapshot', async () => {
    const { action, call, store } = fixture(snapshot('running'));
    expect(await action('interrupt')).toEqual({ ok: true });
    expect(call.mock.calls.filter(([method]) => method === 'task.interrupt')).toHaveLength(1);
    expect(call.mock.calls.some(([method]) => method === 'task.cancel')).toBe(false);
    expect(store.getState().tasks[0].id).toBe('local-task');
    expect(store.getState().liveTasks['backend-task'].snapshot.current_run).toBeUndefined();
    expect(store.getState().liveRuns['old-run'].status).toBe('interrupted');
    expect(store.getState().liveTasks['backend-task'].pendingAction).toBeUndefined();
  });

  it('rejects double clicks before the first asynchronous read completes', async () => {
    const { action, call } = fixture(snapshot('running'));
    const first = action('interrupt');
    expect(await action('interrupt')).toMatchObject({ ok: false });
    expect(await first).toEqual({ ok: true });
    expect(call.mock.calls.filter(([method]) => method === 'task.interrupt')).toHaveLength(1);
  });

  it('resumes the same task into a new run and keeps the interrupted run history', async () => {
    const { action, call, store } = fixture(snapshot('blocked'));
    expect(await action('resume')).toEqual({ ok: true });
    expect(store.getState().tasks).toHaveLength(1);
    expect(store.getState().tasks[0].contractRunId).toBe('resumed-run');
    expect(store.getState().liveRuns['old-run'].status).toBe('interrupted');
    expect(
      call.mock.calls.some(([method]) => ['task.create', 'run.restart'].includes(method)),
    ).toBe(false);
  });

  it('adopts an already completed snapshot without forcing interrupted', async () => {
    const { action, call, store } = fixture(snapshot('completed'));
    expect(await action('interrupt')).toMatchObject({ ok: false });
    expect(store.getState().tasks[0].contractTaskStatus).toBe('completed');
    expect(call.mock.calls.some(([method]) => method === 'task.interrupt')).toBe(false);
  });

  it('surfaces an unavailable recovery anchor and never restarts from scratch', async () => {
    const { action, call, store } = fixture(snapshot('blocked'));
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (method) =>
      method === 'task.resume'
        ? {
            ok: false,
            error: 'anchor invalid',
            code: -32014,
            data: { checkpoint_id: 'cp', reason: 'missing' },
          }
        : original(method),
    );
    expect(await action('resume')).toMatchObject({
      ok: false,
      error: expect.stringContaining('cp'),
    });
    expect(store.getState().tasks[0].contractTaskStatus).toBe('blocked');
    expect(
      call.mock.calls.some(([method]) => ['run.restart', 'task.create'].includes(method)),
    ).toBe(false);
  });

  it('rejects older snapshots and keeps interrupted distinct from failure', () => {
    const { store } = fixture(snapshot('blocked', 4));
    expect(applyTaskSnapshot(store.getState(), snapshot('running', 3))).toEqual({});
    store.setState((state) => applyTaskSnapshot(state, snapshot('blocked', 5)));
    expect(store.getState().liveRuns['old-run'].status).toBe('interrupted');
  });
});

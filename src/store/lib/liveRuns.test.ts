import { describe, expect, it } from 'vitest';
import { createRequirementTask } from '@/data/tasks';
import type { LiveRunState } from '@/store/types';
import { hasActiveTasks } from './liveRuns';

const task = {
  ...createRequirementTask('task', 'project', 'Work'),
  contractTaskId: 'task',
  contractRunId: 'run',
};
const completed: LiveRunState = {
  runId: 'run',
  taskId: 'task',
  status: 'completed',
  timeline: [],
  snapshot: null,
  error: null,
};

describe('routing workspace switch safety', () => {
  it('blocks a just-accepted run before its first observation arrives', () => {
    expect(hasActiveTasks({ tasks: [task], liveRuns: {} })).toBe(true);
  });

  it('blocks a Task waiting for collaboration after its current Run finishes', () => {
    expect(
      hasActiveTasks({
        tasks: [{ ...task, contractTaskStatus: 'waiting_help' }],
        liveRuns: { run: completed },
      }),
    ).toBe(true);
  });

  it('allows browsing and configuring completed projects', () => {
    expect(
      hasActiveTasks({
        tasks: [{ ...task, contractTaskStatus: 'completed' }],
        liveRuns: { run: completed },
      }),
    ).toBe(false);
  });

  it('blocks a running run even if its local Task has not arrived', () => {
    expect(
      hasActiveTasks({ tasks: [], liveRuns: { run: { ...completed, status: 'running' } } }),
    ).toBe(true);
  });
});

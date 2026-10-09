import type { TaskSnapshot } from '@/api/types/task';
import type { DemoState } from '@/store/types';
import { emptyTaskFields, taskToState } from './taskSync';

/** A Task can span several Runs; finishing a Mailbox leg is not final delivery. */
export function applyTaskSnapshot(state: DemoState, snapshot: TaskSnapshot): Partial<DemoState> {
  const taskId = snapshot.task.task_id;
  const previous = state.liveTasks[taskId];
  if (previous && snapshot.revision < previous.snapshot.revision) return {};
  const run = snapshot.current_run ?? snapshot.run_history[0];
  let activeUpdate: Partial<DemoState> = {};
  const tasks = state.tasks.map((task) => {
    if (task.contractTaskId !== taskId) return task;
    const changedRun = !!run && run.run_id !== task.contractRunId;
    const nextTask = {
      ...task,
      ...(changedRun
        ? {
            ...emptyTaskFields(),
            taskText: task.taskText,
            assignedAgentIds: task.assignedAgentIds,
            stage: 'analyzing' as const,
            analysisReady: true,
            replay: undefined,
          }
        : {}),
      contractTaskStatus: snapshot.task.status,
      contractWaitingReason: snapshot.waiting_reason ?? snapshot.error?.message,
      ...(run ? { contractRunId: run.run_id, mode: run.mode } : {}),
    };
    if (changedRun && state.activeTaskId === task.id) activeUpdate = taskToState(nextTask);
    return nextTask;
  });
  return {
    ...activeUpdate,
    tasks,
    liveTasks: {
      ...state.liveTasks,
      [taskId]: {
        ...previous,
        snapshot,
        events: previous?.events ?? [],
        status: 'live',
        error: undefined,
      },
    },
    ...(run && !state.liveRuns[run.run_id]
      ? {
          liveRuns: {
            ...state.liveRuns,
            [run.run_id]: {
              runId: run.run_id,
              taskId,
              status: run.status === 'interrupted' ? 'failed' : run.status,
              timeline: [],
              snapshot: null,
              error: run.error?.message ?? null,
            },
          },
        }
      : {}),
  };
}

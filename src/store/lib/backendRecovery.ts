import type { TaskSnapshot } from '@/api/types/task';
import { createRequirementTask } from '@/data/tasks';
import type { DemoState, LiveRunState, LiveTaskState } from '@/store/types';
import { isAbsoluteFilePath } from '@/lib/projectPaths';

type RecoveredState = Pick<DemoState, 'projects' | 'tasks' | 'liveRuns' | 'liveTasks'>;
const workspaceKey = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
};

/** Restore observations without selecting a project or replacing the user's current task. */
export function recoverBackendTasks(
  state: RecoveredState,
  snapshots: TaskSnapshot[],
): RecoveredState {
  const known = new Set(state.tasks.map((task) => task.contractTaskId));
  const tasks = [...state.tasks];
  const projects = [...state.projects];
  const liveRuns: Record<string, LiveRunState> = { ...state.liveRuns };
  const liveTasks: Record<string, LiveTaskState> = { ...state.liveTasks };

  for (const snapshot of snapshots) {
    const taskId = snapshot.task.task_id;
    const previous = liveTasks[taskId];
    if (previous && snapshot.revision <= previous.snapshot.revision) continue;
    const run = snapshot.current_run ?? snapshot.run_history[0];
    if (!known.has(taskId)) {
      known.add(taskId);
      const workspace = snapshot.task.workspace_path;
      let projectId = 'backend';
      if (workspace && isAbsoluteFilePath(workspace)) {
        const existing = projects.find(
          (project) =>
            project.rootPath && workspaceKey(project.rootPath) === workspaceKey(workspace),
        );
        projectId = existing?.id ?? `backend:${workspaceKey(workspace)}`;
        if (!existing)
          projects.push({
            id: projectId,
            name: workspace.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? workspace,
            rootPath: workspace,
            lastOpened: snapshot.task.updated_at.slice(0, 10),
            tags: [],
            files: [],
            agentIds: [],
          });
      } else if (!projects.some((project) => project.id === projectId)) {
        projects.push({
          id: projectId,
          name: '待确认归属的历史任务',
          lastOpened: snapshot.task.updated_at.slice(0, 10),
          tags: [],
          files: [],
          agentIds: [],
        });
      }
      tasks.push({
        ...createRequirementTask(
          taskId,
          projectId,
          snapshot.task.spec,
          undefined,
          snapshot.task.completion_criteria,
        ),
        contractTaskId: taskId,
        ...(workspace ? { contractWorkspacePath: workspace } : {}),
        contractTaskStatus: snapshot.task.status,
        contractWaitingReason: snapshot.waiting_reason ?? snapshot.error?.message,
        ...(run ? { contractRunId: run.run_id } : {}),
        assignedAgentIds: [
          snapshot.task.role_id,
          snapshot.task.owner_agent_id,
          snapshot.market?.winner_agent_id,
        ].filter((id): id is string => !!id),
      });
    }
    const index = tasks.findIndex((task) => task.contractTaskId === taskId);
    if (index >= 0)
      tasks[index] = {
        ...tasks[index],
        contractTaskStatus: snapshot.task.status,
        contractWaitingReason: snapshot.waiting_reason ?? snapshot.error?.message,
        ...(run ? { contractRunId: run.run_id, mode: run.mode } : {}),
      };
    if (run) {
      liveRuns[run.run_id] = {
        ...liveRuns[run.run_id],
        runId: run.run_id,
        taskId,
        status: run.status,
        timeline: liveRuns[run.run_id]?.timeline ?? [],
        snapshot: liveRuns[run.run_id]?.snapshot ?? null,
        error: run.error?.message ?? null,
      };
    }
    liveTasks[taskId] = {
      ...previous,
      snapshot,
      events: previous?.events ?? [],
      status: 'subscribing',
    };
  }
  return { projects, tasks, liveRuns, liveTasks };
}

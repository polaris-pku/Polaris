import type { DemoTask } from '@/types';
import { freshWorkflowNodes } from '@/data/tasks';
import type { TaskFields } from '@/store/types';

/** 深拷贝一个任务（数组/嵌套对象全部断开引用，防止跨任务串改）。 */
export function cloneTask(task: DemoTask): DemoTask {
  return {
    ...task,
    assignedAgentIds: [...(task.assignedAgentIds ?? [])],
    nodes: task.nodes.map((n) => ({
      ...n,
      input: [...n.input],
      output: [...n.output],
    })),
    interventionRules: task.interventionRules.map((r) => ({
      ...r,
      affectedAgents: [...r.affectedAgents],
    })),
    filePermissionOutcomes: { ...(task.filePermissionOutcomes ?? {}) },
    timeline: [...task.timeline],
  };
}

/** 从实时 state 摘出随任务持久化的字段集合。 */
export function extractTaskFields(state: TaskFields): TaskFields {
  return {
    taskText: state.taskText,
    assignedAgentIds: state.assignedAgentIds,
    stage: state.stage,
    analysisReady: state.analysisReady,
    nodes: state.nodes,
    revealedNodeCount: state.revealedNodeCount,
    activeStepIndex: state.activeStepIndex,
    selectedNodeId: state.selectedNodeId,
    interventionRules: state.interventionRules,
    confirmedCouncilOptionId: state.confirmedCouncilOptionId,
    interventionFeedback: state.interventionFeedback,
    filePermissionOutcomes: state.filePermissionOutcomes,
    timeline: state.timeline,
  };
}

/** 把实时字段回写进任务列表中的活动任务。 */
export function syncTasks(
  tasks: DemoTask[],
  activeTaskId: string | null,
  fields: TaskFields,
): DemoTask[] {
  return tasks.map((t) => (t.id === activeTaskId ? { ...t, ...fields } : t));
}

/** 任务 → 实时 state（深拷贝，切任务时使用）。 */
export function taskToState(task: DemoTask): TaskFields {
  return cloneTask(task);
}

/** 空项目/无任务时的占位任务态（idle） */
export function emptyTaskFields(): TaskFields {
  return {
    taskText: '',
    assignedAgentIds: [],
    stage: 'idle',
    analysisReady: false,
    nodes: freshWorkflowNodes(),
    revealedNodeCount: 0,
    activeStepIndex: -1,
    selectedNodeId: null,
    interventionRules: [],
    confirmedCouncilOptionId: null,
    interventionFeedback: null,
    filePermissionOutcomes: {},
    timeline: [],
  };
}

/** 选出某项目的当前任务（首个任务，或无任务时的空态） */
export function pickProjectTask(
  tasks: DemoTask[],
  projectId: string,
): { activeTaskId: string | null; taskState: TaskFields } {
  const first = tasks.find((t) => t.projectId === projectId);
  return first
    ? { activeTaskId: first.id, taskState: taskToState(first) }
    : { activeTaskId: null, taskState: emptyTaskFields() };
}

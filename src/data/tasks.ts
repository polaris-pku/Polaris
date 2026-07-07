import type { DemoTask, WorkflowNodeData } from '@/types';
import { workflowNodes as baseWorkflowNodes } from '@/data/workflow';
import { recommendAgents } from '@/data/scenario';

const cloneNodes = (): WorkflowNodeData[] =>
  baseWorkflowNodes.map((n) => ({
    ...n,
    input: [...n.input],
    output: [...n.output],
  }));

/** 一份全新的、全部 pending 的工作流节点（供空任务/空项目占位使用） */
export const freshWorkflowNodes = (): WorkflowNodeData[] => cloneNodes();

/**
 * 种子任务。
 * 现从空白开始：没有任何预置任务，任务由用户在项目内新建需求时产生。
 */
export const initialTasks: DemoTask[] = [];

/** 从原始需求文本派生一个简短的任务标题（首行截断，超长加省略号） */
function deriveTitle(text: string, explicit?: string): string {
  const t = explicit?.trim();
  if (t) return t;
  const firstLine = text.split('\n')[0].trim();
  if (!firstLine) return '新需求';
  return firstLine.length > 16 ? `${firstLine.slice(0, 16)}…` : firstLine;
}

/**
 * N0 Intake：用用户输入的原始需求文本创建一个新 Task。
 * 落在 analyzing 阶段——Agent 直接分析并推荐 Workflow（与状态机 N0→N1 对齐）。
 */
export function createRequirementTask(
  id: string,
  projectId: string,
  rawText: string,
  title?: string,
  completionCriteria?: string[],
): DemoTask {
  const taskText = rawText.trim();
  const criteria = completionCriteria?.map((c) => c.trim()).filter(Boolean);
  return {
    id,
    projectId,
    title: deriveTitle(taskText, title),
    taskText,
    ...(criteria?.length ? { completionCriteria: criteria } : {}),
    // N1 Triage：任务创建即带上按需求推荐的团队，团队随任务走。
    assignedAgentIds: recommendAgents(taskText).ids,
    stage: 'analyzing',
    analysisReady: true,
    nodes: cloneNodes(),
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

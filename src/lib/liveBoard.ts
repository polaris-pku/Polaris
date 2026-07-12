/**
 * 把后端事件流**投影**成泳道图的实时状态。
 *
 * 这是「泳道图实时跟着后端走」的核心：每来一条 `run.event`，就用**全部已收到的事件**
 * 重算一次节点状态（幂等，不会因丢事件/乱序而漂移）。
 * 与旧的手动状态机（Next Step / Auto Run 一列一列点）是两条路 —— 真实 run 由后端驱动，
 * 人不再需要点。
 *
 * 铁律：节点状态**只反映后端事件说过的事**。后端没发到的节点就是 pending，不预测、不补位。
 */
import type { RunEvent } from '@/api/types/rpc';
import {
  composeRunWorkflowNodes,
  indicesInColumn,
  primaryIndexInColumn,
  revealedCountThroughColumn,
  stripExecSuffix,
  type ExecAgentSpec,
} from '@/data/workflow';
import { inProgressNodeIds, liveExecAgentsFromEvents, reachedNodeIds } from '@/lib/liveReplay';
import type { DemoStage, WorkflowNodeData } from '@/types';

export type LiveRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type LiveBoardProjection = {
  agents: ExecAgentSpec[];
  nodes: WorkflowNodeData[];
  revealedNodeCount: number;
  activeStepIndex: number;
  stage: DemoStage;
};

/**
 * 投影。返回 null 表示**还不能组图** —— 后端尚未派单（还没收到 mailbox `task.assigned`），
 * 执行泳道有几条要由后端决定，前端不预设条数、不先画一个假的。
 * 这通常只持续到第 4 个事件（约 1 秒）。
 */
export function projectLiveBoard(
  events: RunEvent[],
  runStatus: LiveRunStatus,
): LiveBoardProjection | null {
  const agents = liveExecAgentsFromEvents(events);
  if (agents.length === 0) return null;

  const reached = reachedNodeIds(events);
  // N0「需求到达」后端不单独发事件，但它有据可依：task.created 的 payload 里就带着需求原文
  // —— 需求确实到达了。有事件即成立。
  // （N1「分诊」不补：这个后端没有分诊步骤，它一直是灰的就是事实，不编造。）
  if (events.length > 0) reached.add('n0-intake');
  // 已开始但没结束的节点（典型：N7 执行中 —— agent 正在写代码，可能还要几十秒）
  const inProgress = runStatus === 'running' ? inProgressNodeIds(events) : new Set<string>();
  const base = composeRunWorkflowNodes(agents);

  // 完成 = 抵达过、且不处于「进行中」
  const isDone = (id: string) => reached.has(id) && !inProgress.has(id);

  const doneColumns = base.filter((n) => isDone(stripExecSuffix(n.id))).map((n) => n.column);
  const maxDoneColumn = doneColumns.length ? Math.max(...doneColumns) : -1;

  const inProgressColumns = base
    .filter((n) => inProgress.has(stripExecSuffix(n.id)))
    .map((n) => n.column);

  // 运行中且没有节点正在进行 → 后端处于两步之间，把下一列标 active（表示正往那里推进）
  const frontierColumn =
    runStatus === 'running' && inProgressColumns.length === 0 ? maxDoneColumn + 1 : -1;

  const nodes: WorkflowNodeData[] = base.map((n) => {
    const id = stripExecSuffix(n.id);
    // 正在进行中（agent 此刻真的在做这件事）
    if (inProgress.has(id)) return { ...n, status: 'active' as const };
    if (isDone(id)) {
      // run 失败时，终点节点标 blocked 而不是 done —— 它没真的成功
      const failedEnd = runStatus === 'failed' && id === 'n18-run-complete';
      return { ...n, status: failedEnd ? ('blocked' as const) : ('done' as const) };
    }
    if (n.column === frontierColumn) return { ...n, status: 'active' as const };
    return { ...n, status: 'pending' as const };
  });

  // 揭示到「已完成 / 进行中 / 推进中」的最远那一列
  const revealColumn = Math.max(maxDoneColumn, frontierColumn, ...inProgressColumns, -1);
  const revealedNodeCount = revealedCountThroughColumn(nodes, revealColumn);

  // 焦点列：优先落在正在进行的节点上（用户想看的是 agent 此刻在做什么）
  const focusColumn = inProgressColumns.length
    ? Math.min(...inProgressColumns)
    : frontierColumn >= 0 && indicesInColumn(nodes, frontierColumn).length
      ? frontierColumn
      : maxDoneColumn;
  const activeStepIndex = focusColumn >= 0 ? primaryIndexInColumn(nodes, focusColumn) : -1;

  return {
    agents,
    nodes,
    revealedNodeCount,
    activeStepIndex,
    // 运行中 = executing；终态 = delivery（可查看交付报告，失败的 run 报告里就是错误）
    stage: runStatus === 'running' ? 'executing' : 'delivery',
  };
}

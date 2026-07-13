/**
 * 把后端事件流**投影**成泳道图。
 *
 * 图完全由事件生成（见 lib/eventGraph.ts）——**触发了什么就展示什么**。
 * 每来一条 `run.event` 就用全部已收到的事件重算一次（幂等，不会因丢事件/乱序/重订阅而漂移）。
 *
 * 与旧实现的根本差别：不再有 N0–N18 固定模板。一次 run 不一定触发所有节点
 * （单 agent 模式下 N1 分诊、N14 议会永远不亮），模板会让它们灰着占位、看起来像没跑完。
 * 现在没发生的东西压根不出现。
 */
import type { RunEvent } from '@/api/types/rpc';
import { indicesInColumn, primaryIndexInColumn, revealedCountThroughColumn } from '@/data/workflow';
import { buildEventGraph, type LiveRunStatus } from '@/lib/eventGraph';
import type { DemoStage, WorkflowNodeData } from '@/types';

export type { LiveRunStatus };

export type LiveBoardProjection = {
  nodes: WorkflowNodeData[];
  revealedNodeCount: number;
  activeStepIndex: number;
  stage: DemoStage;
  /** 图上出现的执行 agent（后端派几个就有几个，前端不预设） */
  agents: string[];
};

/** 投影。事件为空 → 还没有图可画，返回 null（调用方保持原状）。 */
export function projectLiveBoard(
  events: RunEvent[],
  runStatus: LiveRunStatus,
): LiveBoardProjection | null {
  if (events.length === 0) return null;

  const { nodes } = buildEventGraph(events, runStatus);
  if (nodes.length === 0) return null;

  // 事件图里所有节点都是「已发生」的 —— 全部揭示，没有待揭示的占位
  const revealedNodeCount = revealedCountThroughColumn(nodes, nodes.length - 1);

  // 焦点列：优先落在进行中的节点（agent 此刻在做的事），否则落在最后一个节点
  const activeIndex = nodes.findIndex((n) => n.status === 'active');
  const focusColumn = activeIndex >= 0 ? nodes[activeIndex].column : nodes[nodes.length - 1].column;
  const activeStepIndex = indicesInColumn(nodes, focusColumn).length
    ? primaryIndexInColumn(nodes, focusColumn)
    : -1;

  const agents = [
    ...new Set(
      nodes.filter((n) => n.direction === 'A' && n.lane !== 'Driver').map((n) => String(n.lane)),
    ),
  ];

  return {
    nodes,
    revealedNodeCount,
    activeStepIndex,
    agents,
    // 运行中 = executing；终态 = delivery（可查看交付报告，失败的 run 报告里就是错误）
    stage: runStatus === 'running' ? 'executing' : 'delivery',
  };
}

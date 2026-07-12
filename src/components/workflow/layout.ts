import type { Node, Edge } from '@xyflow/react';
import type { Lane, NodeExecLogLine, WorkflowNodeData, WorkflowNodeStatus } from '@/types';
import { laneLabels, phaseOfNode, PHASES, type PhaseKey } from '@/data/workflow';

/** 节点级展开：每个节点背后的原始事件行 + 当前展开集合（默认空 = 全收缩） */
export type NodeExpansion = {
  linesByNode: Record<string, NodeExecLogLine[]>;
  expanded: ReadonlySet<string>;
};

export const LANE_HEIGHT = 116;
const NODE_W = 178;
const COL_GAP = 212;
const X_OFFSET = 170;
// 折叠列（该列全部为收起的机器节点）的窄列宽与胶囊尺寸
const COMPACT_COL_GAP = 108;
const CHIP_W = 96;
const CHIP_Y_OFFSET = 58; // 胶囊相对卡片的垂直居中补偿
// 折叠阶段卡：整段（4–6 列）收成一张卡，只占一个列位
const PHASE_W = 150;
const PHASE_COL_GAP = 186;

/** 折叠阶段的聚合状态：任一进行中 → active；有阻塞 → blocked；全完成 → done；否则 pending。 */
function aggregateStatus(nodes: WorkflowNodeData[]): WorkflowNodeStatus {
  if (nodes.some((n) => n.status === 'active')) return 'active';
  if (nodes.some((n) => n.status === 'blocked')) return 'blocked';
  if (nodes.length > 0 && nodes.every((n) => n.status === 'done')) return 'done';
  return 'pending';
}

/**
 * 由已揭示的工作流节点派生 React Flow 的 nodes/edges（纯函数）。
 *
 * 布局规则：
 * - x 由 column 决定（并行兄弟节点共列）；整列折叠时用窄列宽，图整体紧凑。
 * - **阶段折叠**：collapsedPhases 里的阶段，其全部节点收成一张阶段卡，整段只占一个列位；
 *   进出该阶段的连线自动改接到卡上，阶段内部的连线丢弃。
 * - 机器节点折叠（胶囊）在**展开的阶段内部**继续生效，两层收纳互补。
 * - 连线由 deps 决定，支持 fan-out（N3→N4·各 agent）与 fan-in（N9·各 agent→N10）。
 */
export function buildFlowGraph(
  wfNodes: WorkflowNodeData[],
  selectedNodeId: string | null,
  machineExpanded: boolean,
  taskNodes: WorkflowNodeData[] = wfNodes,
  collapsedPhases: ReadonlySet<PhaseKey> = new Set(),
  nodeExpansion: NodeExpansion = { linesByNode: {}, expanded: new Set() },
): { nodes: Node[]; edges: Edge[] } {
  // 泳道完全由任务节点派生（按首次出现顺序，节点数组本身按 column 有序）：
  // 后端派几个 agent 就有几条执行泳道，E 只投影不预设。用任务全量节点
  // （而非已揭示前缀）判定，防止揭示过程中泳道跳动。
  const usedLanes: Lane[] = [];
  for (const n of taskNodes) {
    if (!usedLanes.includes(n.lane)) usedLanes.push(n.lane);
  }
  const laneIndex = (lane: Lane) => usedLanes.indexOf(lane);

  /** 该节点是否被它所属阶段折叠掉了 */
  const isFolded = (n: WorkflowNodeData) => {
    const phase = phaseOfNode(n);
    return !!phase && collapsedPhases.has(phase);
  };

  const visibleNodes = wfNodes.filter((n) => !isFolded(n));
  const foldedNodes = wfNodes.filter(isFolded);

  const isCompact = (wf: WorkflowNodeData) =>
    wf.tier === 'machine' && !machineExpanded && wf.status !== 'active' && selectedNodeId !== wf.id;

  // 列 → 阶段（用任务全量节点判定，避免揭示过程中列归属跳变）
  const phaseOfColumn = new Map<number, PhaseKey>();
  for (const n of taskNodes) {
    const phase = phaseOfNode(n);
    if (phase) phaseOfColumn.set(n.column, phase);
  }

  // 列 x 坐标：折叠阶段的连续列压成一个列位（阶段卡占位）
  const maxRevealedCol = wfNodes.reduce((m, n) => Math.max(m, n.column), 0);
  const colX: number[] = [];
  let cursor = X_OFFSET;
  for (let c = 0; c <= maxRevealedCol; ) {
    const phase = phaseOfColumn.get(c);
    if (phase && collapsedPhases.has(phase)) {
      const startX = cursor;
      // 阶段的列是连续的：把它们全部压到同一个 x
      while (c <= maxRevealedCol && phaseOfColumn.get(c) === phase) {
        colX[c] = startX;
        c += 1;
      }
      cursor += PHASE_COL_GAP;
      continue;
    }
    colX[c] = cursor;
    const colNodes = visibleNodes.filter((n) => n.column === c);
    const compactCol = colNodes.length > 0 && colNodes.every(isCompact);
    cursor += compactCol ? COMPACT_COL_GAP : COL_GAP;
    c += 1;
  }
  const totalWidth = cursor + COL_GAP;

  const laneNodes: Node[] = usedLanes.map((lane, i) => ({
    id: `lane-${lane}`,
    type: 'lane',
    position: { x: 0, y: i * LANE_HEIGHT },
    // agent 泳道无预置标签，直接以 agent 身份为标签
    data: { label: laneLabels[lane] ?? lane, lane, width: totalWidth },
    draggable: false,
    selectable: false,
    zIndex: 0,
    style: { zIndex: 0 },
  }));

  const stepNodes: Node[] = visibleNodes.map((wf) => {
    const compact = isCompact(wf);
    // 胶囊水平居中的参照：整列折叠时对窄列宽居中，混合列时对卡片宽度居中
    const compactCol = visibleNodes.filter((n) => n.column === wf.column).every(isCompact);
    const chipX = colX[wf.column] + ((compactCol ? COMPACT_COL_GAP : NODE_W) - CHIP_W) / 2;
    // 展开态节点的事件浮层要盖过相邻节点 → 抬高 zIndex（仅展开时）
    const isExpanded = nodeExpansion.expanded.has(wf.id);
    const zIndex = isExpanded ? 40 : 5;
    return {
      id: wf.id,
      type: compact ? 'chip' : 'step',
      position: {
        x: compact ? chipX : colX[wf.column],
        y: laneIndex(wf.lane) * LANE_HEIGHT + (compact ? CHIP_Y_OFFSET : 26),
      },
      data: {
        wf,
        selected: selectedNodeId === wf.id,
        isNew: wf.id === visibleNodes[visibleNodes.length - 1]?.id,
        // 胶囊态不展开（太小放不下）；大卡片才带事件行
        lines: compact ? undefined : nodeExpansion.linesByNode[wf.id],
        expanded: isExpanded,
      },
      draggable: false,
      zIndex,
      style: { zIndex, width: compact ? CHIP_W : NODE_W },
    };
  });

  // 折叠阶段 → 阶段卡（每个阶段一张，纵向落在它跨越的泳道中间）
  const phaseNodes: Node[] = [];
  for (const phase of PHASES) {
    if (!collapsedPhases.has(phase.key)) continue;
    const revealed = foldedNodes.filter((n) => phaseOfNode(n) === phase.key);
    if (revealed.length === 0) continue; // 一个都还没揭示 → 阶段卡也不出现

    const all = taskNodes.filter((n) => phaseOfNode(n) === phase.key);
    const lanes = revealed.map((n) => laneIndex(n.lane));
    const midLane = (Math.min(...lanes) + Math.max(...lanes)) / 2;
    const firstCol = Math.min(...revealed.map((n) => n.column));

    phaseNodes.push({
      id: `phase-${phase.key}`,
      type: 'phase',
      position: {
        x: colX[firstCol] + (PHASE_COL_GAP - PHASE_W) / 2,
        y: midLane * LANE_HEIGHT + 26,
      },
      data: {
        phase: phase.key,
        label: phase.label,
        labelCn: phase.labelCn,
        // 进度按**全量**节点算（不是已揭示的）：3/4 才是这个阶段的真实完成度
        done: all.filter((n) => n.status === 'done').length,
        total: all.length,
        status: aggregateStatus(revealed),
      },
      draggable: false,
      zIndex: 5,
      style: { zIndex: 5, width: PHASE_W },
    });
  }

  // 连线：折叠阶段内的节点一律改指它的阶段卡；阶段内部连线丢弃
  const nodeKey = (n: WorkflowNodeData) => {
    const phase = phaseOfNode(n);
    return phase && collapsedPhases.has(phase) ? `phase-${phase}` : n.id;
  };

  const revealedIds = new Set(wfNodes.map((n) => n.id));
  const byId = new Map(wfNodes.map((n) => [n.id, n]));
  const stepEdges: Edge[] = [];
  const seenEdges = new Set<string>();
  for (const to of wfNodes) {
    for (const depId of to.deps) {
      if (!revealedIds.has(depId)) continue;
      const from = byId.get(depId)!;
      const source = nodeKey(from);
      const target = nodeKey(to);
      if (source === target) continue; // 折叠阶段内部的连线：收进卡里，不画
      const edgeId = `${source}-${target}`;
      if (seenEdges.has(edgeId)) continue; // 多条节点级连线塌缩成同一条阶段级连线
      seenEdges.add(edgeId);
      stepEdges.push({
        id: edgeId,
        source,
        target,
        animated: from.status === 'done' && to.status === 'active',
        style: {
          stroke: from.status === 'done' ? '#3b82f6' : '#334155',
          strokeWidth: 1.5,
        },
      });
    }
  }

  return { nodes: [...laneNodes, ...stepNodes, ...phaseNodes], edges: stepEdges };
}

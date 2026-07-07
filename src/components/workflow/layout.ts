import type { Node, Edge } from '@xyflow/react';
import type { Lane, WorkflowNodeData } from '@/types';
import { laneLabels } from '@/data/workflow';

export const LANE_HEIGHT = 116;
const NODE_W = 178;
const COL_GAP = 212;
const X_OFFSET = 170;
// 折叠列（该列全部为收起的机器节点）的窄列宽与胶囊尺寸
const COMPACT_COL_GAP = 108;
const CHIP_W = 76;
const CHIP_Y_OFFSET = 58; // 胶囊相对卡片的垂直居中补偿

/**
 * 由已揭示的工作流节点派生 React Flow 的 nodes/edges（纯函数）。
 *
 * 布局规则：
 * - x 由 column 决定（并行兄弟节点共列）；整列折叠时用窄列宽，图整体紧凑。
 * - 折叠判定：机器节点默认收起；正在执行或被选中的自动展开（渐进披露）。
 * - 连线由 deps 决定，支持 fan-out（N3→N4·BE/TE）与 fan-in（N9·BE/TE→N10）。
 */
export function buildFlowGraph(
  wfNodes: WorkflowNodeData[],
  selectedNodeId: string | null,
  machineExpanded: boolean,
  taskNodes: WorkflowNodeData[] = wfNodes,
): { nodes: Node[]; edges: Edge[] } {
  // 泳道完全由任务节点派生（按首次出现顺序，节点数组本身按 column 有序）：
  // 后端派几个 agent 就有几条执行泳道，E 只投影不预设。用任务全量节点
  // （而非已揭示前缀）判定，防止揭示过程中泳道跳动。
  const usedLanes: Lane[] = [];
  for (const n of taskNodes) {
    if (!usedLanes.includes(n.lane)) usedLanes.push(n.lane);
  }
  const laneIndex = (lane: Lane) => usedLanes.indexOf(lane);

  const isCompact = (wf: WorkflowNodeData) =>
    wf.tier === 'machine' && !machineExpanded && wf.status !== 'active' && selectedNodeId !== wf.id;

  // 列宽压缩：列 x 坐标按累计宽度算
  const maxRevealedCol = wfNodes.reduce((m, n) => Math.max(m, n.column), 0);
  const colX: number[] = [];
  let cursor = X_OFFSET;
  for (let c = 0; c <= maxRevealedCol; c++) {
    colX[c] = cursor;
    const colNodes = wfNodes.filter((n) => n.column === c);
    const compactCol = colNodes.length > 0 && colNodes.every(isCompact);
    cursor += compactCol ? COMPACT_COL_GAP : COL_GAP;
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

  const stepNodes: Node[] = wfNodes.map((wf, i) => {
    const compact = isCompact(wf);
    // 胶囊水平居中的参照：整列折叠时对窄列宽居中，混合列时对卡片宽度居中
    const compactCol = wfNodes.filter((n) => n.column === wf.column).every(isCompact);
    const chipX = colX[wf.column] + ((compactCol ? COMPACT_COL_GAP : NODE_W) - CHIP_W) / 2;
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
        isNew: i === wfNodes.length - 1,
      },
      draggable: false,
      zIndex: 5,
      style: { zIndex: 5, width: compact ? CHIP_W : NODE_W },
    };
  });

  const revealedIds = new Set(wfNodes.map((n) => n.id));
  const byId = new Map(wfNodes.map((n) => [n.id, n]));
  const stepEdges: Edge[] = [];
  for (const to of wfNodes) {
    for (const depId of to.deps) {
      if (!revealedIds.has(depId)) continue;
      const from = byId.get(depId)!;
      const animated = from.status === 'done' && to.status === 'active';
      stepEdges.push({
        id: `${from.id}-${to.id}`,
        source: from.id,
        target: to.id,
        animated,
        style: {
          stroke: from.status === 'done' ? '#3b82f6' : '#334155',
          strokeWidth: 1.5,
        },
      });
    }
  }

  return { nodes: [...laneNodes, ...stepNodes], edges: stepEdges };
}

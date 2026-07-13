import type { Node, Edge } from '@xyflow/react';
import type { Lane, WorkflowNodeData } from '@/types';
import { laneLabels } from '@/data/workflow';

const LANE_HEIGHT = 116;
const NODE_W = 188;
const COL_GAP = 220;
const X_OFFSET = 170;

/**
 * 由已揭示的工作流节点派生 React Flow 的 nodes/edges（纯函数）。
 *
 * 布局规则：
 * - x 由 column 决定（并行兄弟节点共列）；y 由泳道决定（泳道 = 执行者）。
 * - `showMachineSteps === false` 时，`tier === 'machine'` 的步骤（机器握手）**整个不画**，
 *   它们的连线**桥接**到前驱上 —— 事件图的 deps 是一条线性链，桥接后不丢结构。
 *   （右栏把这些步骤聚合成一个「机器握手 · n 步」的 Fold，那才是它们的归宿。）
 * - 阶段折叠（四张阶段卡 + 那四个身兼折叠开关的阶段 chip）已删除：
 *   「亮 = 已展开」与「LED = 当前阶段」两种含义挤在同一个符号里。阶段进度现在只由
 *   运行屏顶部的进度缎带表达，画布只画步骤本身。
 */
export function buildFlowGraph(
  wfNodes: WorkflowNodeData[],
  selectedNodeId: string | null,
  showMachineSteps: boolean,
  taskNodes: WorkflowNodeData[] = wfNodes,
): { nodes: Node[]; edges: Edge[] } {
  /** 机器握手步骤在关闭开关时整个不出现（不是缩成胶囊 —— 开关叫「显示」，就得真的是显示/不显示） */
  const isHidden = (n: WorkflowNodeData) => n.tier === 'machine' && !showMachineSteps;

  // 泳道完全由任务节点派生（按首次出现顺序，节点数组本身按 column 有序）：
  // 后端派几个 agent 就有几条执行泳道，前端只投影不预设。用任务全量节点（而非已揭示前缀）
  // 判定，防止揭示过程中泳道跳动；被隐藏的机器步骤不占泳道，否则会留下一条空泳道。
  const usedLanes: Lane[] = [];
  for (const n of taskNodes) {
    if (isHidden(n)) continue;
    if (!usedLanes.includes(n.lane)) usedLanes.push(n.lane);
  }
  const laneIndex = (lane: Lane) => usedLanes.indexOf(lane);

  const visibleNodes = wfNodes.filter((n) => !isHidden(n));

  // 列 x 坐标：隐藏的机器步骤如果独占一列，这一列直接不占位（图不会留一段空白）
  const maxRevealedCol = visibleNodes.reduce((m, n) => Math.max(m, n.column), 0);
  const colX: number[] = [];
  let cursor = X_OFFSET;
  for (let c = 0; c <= maxRevealedCol; c += 1) {
    colX[c] = cursor;
    if (visibleNodes.some((n) => n.column === c)) cursor += COL_GAP;
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

  const stepNodes: Node[] = visibleNodes.map((wf) => ({
    id: wf.id,
    type: 'step',
    position: {
      x: colX[wf.column],
      y: laneIndex(wf.lane) * LANE_HEIGHT + 26,
    },
    data: {
      wf,
      selected: selectedNodeId === wf.id,
      isNew: wf.id === visibleNodes[visibleNodes.length - 1]?.id,
    },
    draggable: false,
    zIndex: 5,
    style: { zIndex: 5, width: NODE_W },
  }));

  // 连线：deps 指向被隐藏的机器步骤时，沿它的 deps 继续上溯，把线接到最近的可见前驱上。
  const byId = new Map(wfNodes.map((n) => [n.id, n]));
  const visibleDepsOf = (id: string, seen: Set<string>): string[] => {
    const n = byId.get(id);
    if (!n || seen.has(id)) return []; // 未揭示的前驱不连线；seen 防环
    seen.add(id);
    if (!isHidden(n)) return [id];
    return n.deps.flatMap((d) => visibleDepsOf(d, seen));
  };

  const stepEdges: Edge[] = [];
  const seenEdges = new Set<string>();
  for (const to of visibleNodes) {
    for (const depId of to.deps) {
      for (const sourceId of visibleDepsOf(depId, new Set())) {
        if (sourceId === to.id) continue;
        const edgeId = `${sourceId}-${to.id}`;
        if (seenEdges.has(edgeId)) continue; // 多条连线桥接后可能塌缩成同一条
        seenEdges.add(edgeId);
        const from = byId.get(sourceId);
        stepEdges.push({
          id: edgeId,
          source: sourceId,
          target: to.id,
          // 连线颜色由 index.css 的 .react-flow__edge-path 统一给（edge-strong / animated 走 command），
          // 这里不再写死十六进制 —— 颜色只允许活在 token 层。
          animated: from?.status === 'done' && to.status === 'active',
        });
      }
    }
  }

  return { nodes: [...laneNodes, ...stepNodes], edges: stepEdges };
}

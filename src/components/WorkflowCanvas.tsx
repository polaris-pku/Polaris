import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useReactFlow,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
  type Viewport,
} from '@xyflow/react';
import type { WorkflowNodeData } from '@/types';
import { lanes, laneLabels, NODE_IDS } from '@/data/workflow';
import { useDemoStore } from '@/store/useDemoStore';
import { cn } from '@/lib/utils';

const LANE_HEIGHT = 116;
const NODE_W = 178;
const COL_GAP = 212;
const X_OFFSET = 170;
// 折叠列（该列全部为收起的机器节点）的窄列宽与胶囊尺寸
const COMPACT_COL_GAP = 108;
const CHIP_W = 76;
const CHIP_Y_OFFSET = 58; // 胶囊相对卡片的垂直居中补偿

// 跨页面切换（TaskBoard 卸载/重挂）保留画布视口（缩放 + 平移）。
// 模块级变量在组件重挂后依然存活，使切回 Task Board 时维持切走前的视图。
let savedViewport: Viewport | null = null;
// 「展开机器节点」偏好同样跨重挂存活（会话级，不入存盘）
let savedMachineExpanded = false;

const laneAccent: Record<string, string> = {
  User: 'border-l-human/70', // the human's own lane glows warm
  System: 'border-l-command/70', // 调度 / 协调 — command azure
  Backend: 'border-l-sky-500/60', // 后端 Agent
  Test: 'border-l-teal-500/60', // 测试 Agent
  Security: 'border-l-indigo-500/60', // 安全 / Gate
  Council: 'border-l-violet-500/60',
};

// 责任方角标配色（A/B/C/D/User/Merger）
const directionStyles: Record<string, string> = {
  User: 'bg-human/15 text-human-soft',
  A: 'bg-sky-500/15 text-sky-300',
  B: 'bg-teal-500/15 text-teal-300',
  C: 'bg-command/15 text-command-soft',
  D: 'bg-indigo-500/15 text-indigo-300',
  Merger: 'bg-emerald-500/15 text-emerald-300',
};

const statusStyles: Record<
  WorkflowNodeData['status'],
  { box: string; dot: string; label: string }
> = {
  pending: {
    box: 'border-line-bright bg-ink-850 text-slate-400',
    dot: 'bg-slate-600',
    label: '待执行',
  },
  active: {
    box: 'border-command bg-command/15 text-slate-100 shadow-glow',
    dot: 'bg-command animate-pulse-ring',
    label: '执行中',
  },
  done: {
    box: 'border-emerald-500/60 bg-emerald-600/10 text-emerald-100',
    dot: 'bg-emerald-400',
    label: '已完成',
  },
  blocked: {
    box: 'border-rose-500/70 bg-rose-600/10 text-rose-100',
    dot: 'bg-rose-400',
    label: '已阻塞',
  },
  updated: {
    box: 'border-dashed border-human/70 bg-human/10 text-human-soft shadow-glow-human',
    dot: 'bg-human',
    label: '已被介入',
  },
};

type StepNodeData = {
  wf: WorkflowNodeData;
  selected: boolean;
  isNew?: boolean;
};

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { wf, selected, isNew } = data;
  const s = statusStyles[wf.status];
  // 节点上展示的状态码：优先 canonical TaskStatus，否则用 statusNote 占位
  const statusCode = wf.taskStatus ?? wf.statusNote ?? '—';
  return (
    <div
      className={cn(
        'w-[182px] rounded-md border px-3 py-2.5 transition-all cursor-pointer',
        s.box,
        selected && 'ring-2 ring-white/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <span className="font-mono text-[9px] font-semibold text-slate-300">{wf.code}</span>
          <span
            className={cn(
              'rounded px-1 py-px font-mono text-[8px] font-semibold',
              directionStyles[wf.direction] ?? 'bg-slate-700/40 text-slate-400',
            )}
          >
            {wf.direction}
          </span>
          {/* 人的时刻标记（tier=human）：琥珀菱形，与介入/确认的暖色语义一致 */}
          {wf.tier === 'human' && <span className="text-[8px] leading-none text-human">◆</span>}
        </span>
        <span className={cn('led h-2 w-2', s.dot)} />
      </div>
      <div className="mt-1 font-display text-[13px] font-semibold leading-tight">{wf.label}</div>
      <div className="truncate text-[10px] text-slate-400">{wf.labelCn}</div>
      <div className="mt-1.5 truncate font-mono text-[9px] text-slate-500">{statusCode}</div>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

/**
 * 机器节点的折叠态：小胶囊（状态点 + 节点编号）。
 * 点击仍可选中（Inspector 照常工作）并展开为大卡片；title 提供悬停释义。
 */
function ChipNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { wf, selected, isNew } = data;
  const s = statusStyles[wf.status];
  return (
    <div
      title={`${wf.code} ${wf.label} · ${wf.labelCn}（${wf.owner}）`}
      className={cn(
        'flex w-[76px] cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2 py-1 transition-all',
        s.box,
        selected && 'ring-2 ring-white/40',
        isNew && 'animate-fade-in',
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span className={cn('led h-1.5 w-1.5 shrink-0', s.dot)} />
      <span className="font-mono text-[9px] font-semibold">{wf.code}</span>
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<{ label: string; lane: string; width: number }>>) {
  return (
    <div
      className={cn(
        'h-[116px] rounded-r-md border-l-[3px] bg-ink-900/30',
        laneAccent[data.lane] ?? 'border-l-slate-600',
      )}
      style={{ width: data.width }}
    >
      <div className="callsign px-3 py-2 text-[10px] text-slate-400">{data.label}</div>
    </div>
  );
}

const nodeTypes = {
  step: StepNode,
  chip: ChipNode,
  lane: LaneNode,
};

function WorkflowCanvasInner() {
  const allNodes = useDemoStore((s) => s.nodes);
  const revealedNodeCount = useDemoStore((s) => s.revealedNodeCount);
  const selectedNodeId = useDemoStore((s) => s.selectedNodeId);
  const selectNode = useDemoStore((s) => s.selectNode);
  const goToCouncil = useDemoStore((s) => s.goToCouncil);
  const { fitView, getViewport } = useReactFlow();
  const prevRevealedCount = useRef(0);

  // 卸载（切走 Task Board）时记下当前视口，切回时由 defaultViewport 恢复
  useEffect(() => {
    return () => {
      savedViewport = getViewport();
    };
  }, [getViewport]);

  // 「展开机器节点」：默认折叠成胶囊；活动/选中节点自动展开不受此开关影响
  const [machineExpanded, setMachineExpanded] = useState(savedMachineExpanded);
  const toggleMachineExpanded = useCallback(() => {
    setMachineExpanded((v) => {
      savedMachineExpanded = !v;
      return !v;
    });
  }, []);

  const wfNodes = useMemo(
    () => allNodes.slice(0, revealedNodeCount),
    [allNodes, revealedNodeCount],
  );

  // 折叠开关切换后布局宽度变化明显，整体重新适配视口（首挂载不触发，保留恢复的视口）
  const prevExpanded = useRef(machineExpanded);
  useEffect(() => {
    if (prevExpanded.current === machineExpanded) return;
    prevExpanded.current = machineExpanded;
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [machineExpanded, fitView]);

  // 回退 Checkpoint（节点数变少）时自动 fit；正常前进新增节点不重置用户缩放。
  useEffect(() => {
    const prev = prevRevealedCount.current;
    prevRevealedCount.current = revealedNodeCount;

    if (revealedNodeCount < prev) {
      const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
      return () => clearTimeout(t);
    }
  }, [revealedNodeCount, fitView]);

  // 画布就绪时：首次（无保留视口）以「全屏适配」视角呈现；
  // 切回页面时 defaultViewport 已恢复上次视口，这里不再覆盖。
  const onInit = useCallback(() => {
    if (!savedViewport) fitView({ padding: 0.15, maxZoom: 1 });
  }, [fitView]);

  // 记录用户/程序对视口的每次改动，供切回页面时恢复
  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    savedViewport = vp;
  }, []);

  const { nodes: computedNodes, edges: computedEdges } = useMemo(() => {
    const laneIndex = (lane: string) => lanes.indexOf(lane as never);

    // 折叠判定：机器节点默认收起；正在执行或被选中的自动展开（渐进披露）
    const isCompact = (wf: WorkflowNodeData) =>
      wf.tier === 'machine' &&
      !machineExpanded &&
      wf.status !== 'active' &&
      selectedNodeId !== wf.id;

    // 列宽压缩：整列都是折叠胶囊时用窄列，图整体紧凑；列 x 坐标按累计宽度算
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

    const laneNodes: Node[] = lanes.map((lane, i) => ({
      id: `lane-${lane}`,
      type: 'lane',
      position: { x: 0, y: i * LANE_HEIGHT },
      data: { label: laneLabels[lane], lane, width: totalWidth },
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
          // x 由 column 决定，使并行兄弟节点共列
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

    // 连线由 deps 决定，支持 fan-out（N3→N4·BE/TE）与 fan-in（N9·BE/TE→N10）
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
  }, [wfNodes, selectedNodeId, machineExpanded]);

  // 受控模式：把派生的 nodes/edges 全量同步进 React Flow 内部 store，
  // 保证前进、回退 Checkpoint、Reset 等任何 store 变化都整体刷新画布。
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setRfNodes(computedNodes);
  }, [computedNodes, setRfNodes]);
  useEffect(() => {
    setRfEdges(computedEdges);
  }, [computedEdges, setRfEdges]);

  // 单击选中即展开；再次单击同一节点取消选中，机器节点随之收缩回胶囊
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === 'step' || node.type === 'chip') {
        selectNode(selectedNodeId === node.id ? null : node.id);
      }
    },
    [selectNode, selectedNodeId],
  );

  // 双击 N14 Council 节点 → 前往 Council Board（与 DEMO CONTROLS 的 Go to Council 同一动作）
  const onNodeDoubleClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.id === NODE_IDS.council) goToCouncil();
    },
    [goToCouncil],
  );

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {/* 双击手势提示：纯展示，不拦截事件 */}
        <span className="pointer-events-none rounded-full border border-violet-500/40 bg-ink-850/90 px-2.5 py-1 font-mono text-[10px] text-violet-300/80">
          双击 Council 节点 → 议会
        </span>
        {/* 渐进披露开关：机器节点（A/B/C/D 内部握手）默认折叠成胶囊 */}
        <button
          type="button"
          onClick={toggleMachineExpanded}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors',
            machineExpanded
              ? 'border-command/50 bg-command/15 text-command-soft'
              : 'border-line-bright bg-ink-850/90 text-slate-400 hover:text-slate-200',
          )}
        >
          <span
            className={cn('led h-1.5 w-1.5', machineExpanded ? 'bg-command' : 'bg-slate-600')}
          />
          管道节点 · {machineExpanded ? '已展开' : '已折叠'}
        </button>
      </div>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        onMoveEnd={onMoveEnd}
        defaultViewport={savedViewport ?? undefined}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        className="bg-ink-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
        <Controls
          showInteractive={false}
          className="!bg-ink-800 !border-slate-700 [&_button]:!bg-ink-700 [&_button]:!border-slate-700 [&_button]:!text-slate-300"
        />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type Viewport,
} from '@xyflow/react';
import { NODE_IDS } from '@/data/workflow';
import { useDemoStore } from '@/store/useDemoStore';
import { cn } from '@/lib/utils';
import { nodeTypes } from '@/components/workflow/nodes';
import { buildFlowGraph } from '@/components/workflow/layout';

// 跨页面切换（TaskBoard 卸载/重挂）保留画布视口（缩放 + 平移）。
// 模块级变量在组件重挂后依然存活，使切回 Task Board 时维持切走前的视图。
let savedViewport: Viewport | null = null;
// 「展开机器节点」偏好同样跨重挂存活（会话级，不入存盘）
let savedMachineExpanded = false;

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

  const { nodes: computedNodes, edges: computedEdges } = useMemo(
    () => buildFlowGraph(wfNodes, selectedNodeId, machineExpanded, allNodes),
    [wfNodes, selectedNodeId, machineExpanded, allNodes],
  );

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

  // 双击 N14 Council 节点 → 前往 Council Board（与控制栏的 Go to Council 同一动作）
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

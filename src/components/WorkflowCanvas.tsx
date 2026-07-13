import { useCallback, useEffect, useMemo, useRef } from 'react';
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
import { useDemoStore } from '@/store/useDemoStore';
import { nodeTypes } from '@/components/workflow/nodeTypes';
import { buildFlowGraph } from '@/components/workflow/layout';

// 跨页面切换（TaskBoard 卸载/重挂）保留画布视口（缩放 + 平移）。
// 模块级变量在组件重挂后依然存活，使切回任务页时维持切走前的视图。
let savedViewport: Viewport | null = null;

/** 真实 run 镜头跟随时的缩放：够近能读清节点，又留得下周边上下文 */
const FOCUS_ZOOM = 0.85;

function WorkflowCanvasInner({ showMachineSteps }: { showMachineSteps: boolean }) {
  const allNodes = useDemoStore((s) => s.nodes);
  const revealedNodeCount = useDemoStore((s) => s.revealedNodeCount);
  const selectedNodeId = useDemoStore((s) => s.selectedNodeId);
  const selectNode = useDemoStore((s) => s.selectNode);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  // 真实后端 run：节点是后端推进时**自己冒出来**的，不是用户点出来的
  const isLiveRun = useDemoStore(
    (s) => !!s.tasks.find((t) => t.id === s.activeTaskId)?.contractRunId,
  );
  const { fitView, getViewport, setCenter, getInternalNode } = useReactFlow();
  /** React Flow 上一次实际持有的节点数（视口适配以它为准，见下方 effect） */
  const prevRfCount = useRef(0);
  /**
   * 已**成功居中**过的节点 id（不是「尝试过」——见下方镜头跟随 effect 的注释）。
   */
  const focusedId = useRef<string | null>(null);

  // 卸载（切走任务页）时记下当前视口，切回时由 defaultViewport 恢复
  useEffect(() => {
    return () => {
      savedViewport = getViewport();
    };
  }, [getViewport]);

  const wfNodes = useMemo(
    () => allNodes.slice(0, revealedNodeCount),
    [allNodes, revealedNodeCount],
  );

  // 「显示机器握手步骤」切换后图的宽度变化明显，整体重新适配视口（首挂载不触发，保留恢复的视口）
  const prevShowMachine = useRef(showMachineSteps);
  useEffect(() => {
    if (prevShowMachine.current === showMachineSteps) return;
    prevShowMachine.current = showMachineSteps;
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [showMachineSteps, fitView]);

  // 换任务：视口是模块级的（供切页面时恢复），跨任务残留会让新任务的画布停在上一个任务
  // 拖到的位置 —— 节点长在视野外，看起来就是「图漂移、找不到节点」。换任务必须重置。
  const prevTaskId = useRef<string | null>(null);
  useEffect(() => {
    if (prevTaskId.current === activeTaskId) return;
    prevTaskId.current = activeTaskId;
    savedViewport = null;
    prevRfCount.current = 0;
    focusedId.current = null;
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [activeTaskId, fitView]);

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
    () => buildFlowGraph(wfNodes, selectedNodeId, showMachineSteps, allNodes),
    [wfNodes, selectedNodeId, showMachineSteps, allNodes],
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

  // 回退 Checkpoint（节点数变少）→ 重新适配。正常前进不动用户的缩放。
  useEffect(() => {
    const prev = prevRfCount.current;
    prevRfCount.current = rfNodes.length;
    if (rfNodes.length >= prev) return;
    const t = setTimeout(() => fitView({ padding: 0.15, maxZoom: 1, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [rfNodes.length, fitView]);

  /** 焦点节点这一刻是否真的画在图上（机器握手步骤被关掉时，它可能压根没渲染） */
  const focusVisible = useMemo(
    () => !!selectedNodeId && computedNodes.some((n) => n.id === selectedNodeId),
    [computedNodes, selectedNodeId],
  );

  /**
   * 真实 run：镜头跟着后端推进的节点走，让它停在视野中心。
   *
   * 不用「把全图塞进视野」——整图适配会缩到看不清，而且塞不下。真正有用的是：
   * **agent 现在做到哪，镜头就在哪。**
   *
   * focusNodeId 即 store 的 selectedNodeId —— applyLiveProgress 里让它跟随 active 节点；
   * 用户手动点选时它同样变化，于是「点谁就居中谁」，两种情况行为一致。
   * 依赖里带上 rfNodes.length：新节点刚进 React Flow 时还没量好尺寸，节点数变化后要重定位。
   */
  // 判重必须按**已成功居中**，不能按「尝试过」：
  // 焦点变化与节点入场常在同一帧 —— 那时 React Flow 里还没有这个节点，居中必然失败；
  // 紧接着 rfNodes.length 变化会让本 effect 重跑（并 cleanup 掉上一次的 rAF 重试），
  // 若按「尝试过」判重，重跑就会认为「焦点没变」直接 return —— 结果一次都没居中成。
  // 这正是实测「焦点节点在跟着后端走，但镜头纹丝不动」的原因。
  useEffect(() => {
    if (!isLiveRun || !selectedNodeId || !focusVisible) return;
    if (focusedId.current === selectedNodeId) return;

    let cancelled = false;
    let tries = 0;

    const focus = (): boolean => {
      const node = getInternalNode(selectedNodeId);
      const width = node?.measured?.width;
      const height = node?.measured?.height;
      // 节点刚进 React Flow 时尺寸还没量好（measured 为空）→ 这一帧定位不了，下一帧再试
      if (!node || !width || !height) return false;
      const { x, y } = node.internals.positionAbsolute;
      setCenter(x + width / 2, y + height / 2, { zoom: FOCUS_ZOOM, duration: 450 });
      focusedId.current = selectedNodeId;
      return true;
    };

    const tick = () => {
      if (cancelled || focus() || ++tries > 60) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, isLiveRun, focusVisible, rfNodes.length, getInternalNode, setCenter]);

  /**
   * 单击选中即展开右栏的「步骤」Fold；再次单击同一节点取消选中。
   *
   * 卡片上不再有「就地展开原始事件」的面板 —— 原始事件全应用只有一个出口（Dock › 事件流），
   * 它的入口在右栏每个 Fold 的 D2 末尾那一行。画布不是第二个出口。
   */
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type !== 'step') return;
      selectNode(selectedNodeId === node.id ? null : node.id);
    },
    [selectNode, selectedNodeId],
  );

  return (
    <div className="relative h-full w-full">
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
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.4}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        className="bg-surface-void"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e2636" />
        <Controls
          showInteractive={false}
          className="!border-edge !bg-surface-panel [&_button]:!border-edge [&_button]:!bg-surface-raised [&_button]:!text-fg-secondary"
        />
      </ReactFlow>
    </div>
  );
}

/**
 * 泳道图 —— **第二视图**。
 *
 * 默认视图是运行屏的步骤轨：事件图的 deps 是一条**线性链**，真实 run 的「图」其实是一条直线，
 * 用图渲染器画直线是在浪费整块舞台。只有后端扇出多个 agent（泳道 > 2 条）时，
 * 图才真正比轨道多说了一句话 —— 那时它才该当默认（由 TaskBoard 决定，不在这里）。
 */
export function WorkflowCanvas({ showMachineSteps }: { showMachineSteps: boolean }) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner showMachineSteps={showMachineSteps} />
    </ReactFlowProvider>
  );
}

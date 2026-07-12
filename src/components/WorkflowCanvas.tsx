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
import { NODE_IDS, PHASES, phaseOfNode, stripExecSuffix, type PhaseKey } from '@/data/workflow';
import type { NodeExecLogLine } from '@/types';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { cn } from '@/lib/utils';
import { nodeTypes } from '@/components/workflow/nodes';
import { buildFlowGraph } from '@/components/workflow/layout';

// 跨页面切换（TaskBoard 卸载/重挂）保留画布视口（缩放 + 平移）。
// 模块级变量在组件重挂后依然存活，使切回 Task Board 时维持切走前的视图。
let savedViewport: Viewport | null = null;
// 「展开机器节点」偏好同样跨重挂存活（会话级，不入存盘）
let savedMachineExpanded = false;

/** 真实 run 镜头跟随时的缩放：够近能读清节点，又留得下周边上下文 */
const FOCUS_ZOOM = 0.85;

function WorkflowCanvasInner() {
  const allNodes = useDemoStore((s) => s.nodes);
  const revealedNodeCount = useDemoStore((s) => s.revealedNodeCount);
  const selectedNodeId = useDemoStore((s) => s.selectedNodeId);
  const selectNode = useDemoStore((s) => s.selectNode);
  const goToCouncil = useDemoStore((s) => s.goToCouncil);
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

  // 换任务：视口是模块级的（供切页面时恢复），跨任务残留会让新任务的画布停在上一个任务
  // 拖到的位置 —— 节点长在视野外，看起来就是「泳道图漂移、找不到节点」。换任务必须重置。
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

  /**
   * 阶段折叠（渐进披露）。
   *
   * 默认：只展开 agent 此刻所在的那个阶段，其余三段收成阶段卡。run 推进到下一阶段时，
   * 上一阶段自动收回。这样任何时刻画布上只有 4–6 个节点 + 3 张卡，而不是 18 个节点一次涌现。
   *
   * 用户点开/收起某个阶段后，该阶段进入「手动模式」，不再被自动收回 —— 人的意图优先于自动策略。
   */
  const [manualPhases, setManualPhases] = useState<Partial<Record<PhaseKey, boolean>>>({});
  const activePhase = useMemo(() => {
    // 焦点节点所在的阶段就是「当前阶段」（live run 里焦点跟随后端推进）
    const focus = allNodes.find((n) => n.id === selectedNodeId);
    const running = allNodes.find((n) => n.status === 'active');
    const node = focus ?? running;
    return node ? phaseOfNode(node) : undefined;
  }, [allNodes, selectedNodeId]);

  const collapsedPhases = useMemo(() => {
    const collapsed = new Set<PhaseKey>();
    for (const phase of PHASES) {
      const manual = manualPhases[phase.key];
      const expanded = manual ?? phase.key === activePhase;
      if (!expanded) collapsed.add(phase.key);
    }
    return collapsed;
  }, [manualPhases, activePhase]);

  // ── 节点级展开：把一个步骤背后的原始事件铺开成「小节点」 ──
  // 默认全部收缩（空集合）；点击节点上的展开钮把它加入/移出这个集合。
  const [expandedNodes, setExpandedNodes] = useState<ReadonlySet<string>>(new Set());
  const toggleNodeExpanded = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 每个节点背后的人话事件行（复用 Inspector 那份 nodeExecLogs；节点 id 可能带执行后缀，两个键都试）
  const replay = useDemoStore(selectActiveReplay);
  const nodeExpansion = useMemo(() => {
    // 只用后端事件派生的 nodeExecLogs（与节点详情面板同源）；没有真实 run 就没有可展开的事件。
    const src = replay?.nodeExecLogs;
    const linesByNode: Record<string, NodeExecLogLine[]> = {};
    if (src) {
      for (const n of allNodes) {
        const detail = src[n.id] ?? src[stripExecSuffix(n.id)];
        if (detail?.lines.length) linesByNode[n.id] = detail.lines;
      }
    }
    return { linesByNode, expanded: expandedNodes };
  }, [replay, allNodes, expandedNodes]);

  const togglePhase = useCallback(
    (key: PhaseKey) => {
      setManualPhases((prev) => {
        // 以「当前实际展开与否」为准取反 —— 否则从自动态第一次点击会没反应
        const expanded = prev[key] ?? key === activePhase;
        return { ...prev, [key]: !expanded };
      });
    },
    [activePhase],
  );

  const { nodes: computedNodes, edges: computedEdges } = useMemo(
    () =>
      buildFlowGraph(
        wfNodes,
        selectedNodeId,
        machineExpanded,
        allNodes,
        collapsedPhases,
        nodeExpansion,
      ),
    [wfNodes, selectedNodeId, machineExpanded, allNodes, collapsedPhases, nodeExpansion],
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

  /**
   * 真实 run：镜头跟着后端推进的节点走，让它停在视野中心。
   *
   * 不用「把全图塞进视野」——N0–N18 这张图很宽，整图适配会缩到 0.4 倍**还是塞不下**
   * （实测：左边 N0/N1 与右边 N17/N18 同时溢出，23 个节点只有 19 个可见），
   * 而且塞得进也小到看不清。真正有用的是：**agent 现在做到哪，镜头就在哪。**
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
    if (!isLiveRun || !selectedNodeId) return;
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
  }, [selectedNodeId, isLiveRun, rfNodes.length, getInternalNode, setCenter]);

  // 单击选中即展开；再次单击同一节点取消选中，机器节点随之收缩回胶囊。
  // 点击折叠的阶段卡 → 展开该阶段。
  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (node.type === 'step' || node.type === 'chip') {
        // 点在「展开钮」上 = 就地铺开/收起这一步的原始事件，不切换选中（Inspector 不受影响）
        if ((event.target as HTMLElement | null)?.closest('[data-role="node-expand"]')) {
          toggleNodeExpanded(node.id);
          return;
        }
        selectNode(selectedNodeId === node.id ? null : node.id);
        return;
      }
      if (node.type === 'phase') {
        togglePhase((node.data as { phase: PhaseKey }).phase);
      }
    },
    [selectNode, selectedNodeId, togglePhase, toggleNodeExpanded],
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
      {/* 阶段开关：四段各一个，可随时展开/收起。默认只展开 agent 所在的那段（渐进披露）。 */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1">
        {PHASES.map((phase) => {
          const expanded = !collapsedPhases.has(phase.key);
          const isActive = phase.key === activePhase;
          return (
            <button
              key={phase.key}
              type="button"
              onClick={() => togglePhase(phase.key)}
              title={`${phase.labelCn}（${expanded ? '已展开，点击收起' : '已折叠，点击展开'}）`}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[10px] transition-colors',
                expanded
                  ? 'border-command/50 bg-command/15 text-command-soft'
                  : 'border-line-bright bg-ink-850/90 text-slate-500 hover:text-slate-300',
              )}
            >
              {isActive && <span className="led h-1.5 w-1.5 bg-command animate-pulse-ring" />}
              {phase.labelCn}
            </button>
          );
        })}
      </div>

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

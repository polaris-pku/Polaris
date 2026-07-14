/**
 * 运行屏 —— **这一屏只回答四个问题：谁 / 在做什么 / 多久了 / 成没成。**
 *
 * 验收判据：陌生人站两米外看 3 秒，能说出这四件事。所以主句是全屏唯一的 24px，
 * 而它上面/下面的一切都必须让路：
 *
 *   面包屑（定位，20px）→ 主句带 → 进度缎带 → 步骤轨（或画布）→ 主行动（仅 idle / 失败时存在）
 *
 * 对照重设计前的这一屏，**已经删掉的东西**：两枚状态徽章（其中一枚在 mock 移除后已经零区分度）、
 * 半截 uuid 的协调器铭牌、模式 / 执行器 的机器铭牌、常驻的任务描述输入框、5 个英文按钮的控制栏、
 * 「根据流程进度自动显示可用操作」、空状态里背协议规格的那句话、
 * 「后端执行中 · 泳道图随 agent 实时推进（已收到 N 个事件）」、需求分析面板、
 * 那三个只改本地状态的手动推进按钮、以及整条执行时间轴。
 * **新出现的**：一句话。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, MoreHorizontal, Workflow } from 'lucide-react';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';
import { onBackendStatus } from '@/api/events';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { Breadcrumb } from '@/components/run/Breadcrumb';
import { MissionLine } from '@/components/run/MissionLine';
import { ProgressRibbon } from '@/components/run/ProgressRibbon';
import { StepRail } from '@/components/run/StepRail';
import { OutputStage } from '@/components/run/OutputStage';
import { PrimaryAction } from '@/components/run/PrimaryAction';
import { RunFoldColumn } from '@/components/run/RunFoldColumn';
import { missionLineOf, phaseSegments } from '@/lib/missionLine';
import { artifactFactsOf } from '@/lib/runFacts';
import { runStateOf } from '@/lib/runState';
import { useNow } from '@/lib/elapsed';
import { revealAgentFile } from '@/lib/agentFs';
import { cn } from '@/lib/utils';

export function TaskBoard() {
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  if (!activeTaskId) return <NoTaskBoard />;
  return <TaskBoardInner />;
}

function TaskBoardInner() {
  const tasks = useDemoStore((s) => s.tasks);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  const liveRun = useDemoStore(selectActiveLiveRun);
  const nodes = useDemoStore((s) => s.nodes);
  const selectedNodeId = useDemoStore((s) => s.selectedNodeId);
  const selectNode = useDemoStore((s) => s.selectNode);
  const eventChannelStatus = useDemoStore((s) => s.eventChannelStatus);
  const projects = useDemoStore((s) => s.projects);
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const startTask = useDemoStore((s) => s.startTask);
  const useRecommendedWorkflow = useDemoStore((s) => s.useRecommendedWorkflow);
  const retrySubmit = useDemoStore((s) => s.retrySubmit);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const state = runStateOf(activeTask, liveRun);

  // 秒表只在 run 还活着时走 —— 终态之后每秒重渲染整块运行屏是白烧电。
  const now = useNow(1000, state === 'running' || state === 'blocked');
  const mission = missionLineOf({ task: activeTask, live: liveRun, now });

  // agent 的工作区（文件真正写到哪）。它是后端的**全局状态** —— 界面上看不见的话，
  // 文件写进别的项目也毫无察觉：run 照样显示已交付，产物却不在你的目录里。
  const [workspace, setWorkspace] = useState('');
  useEffect(() => onBackendStatus((s) => setWorkspace(s.workspace)), []);

  // 两个视图开关都是**本地状态**，不进 store：它们是这一屏的看法，不是这次 run 的事实。
  const [view, setView] = useState<'rail' | 'canvas' | null>(null);
  const [showMachineSteps, setShowMachineSteps] = useState(false);

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>(undefined);

  const onRetry = useCallback(() => {
    if (!activeTask || retrying) return;
    setRetrying(true);
    setRetryError(undefined);
    void retrySubmit(activeTask.id).then((result) => {
      setRetrying(false);
      if (!result.ok) setRetryError(result.error);
    });
  }, [activeTask, retrying, retrySubmit]);

  // 多 agent 扇出时，图才真的是图 —— 只有那时它才自动成为默认视图。
  //
  // ⚠️ 这里必须数**执行者泳道**，不能数全部泳道。
  // 全部泳道包括 System / Memory / Driver 这些责任方分区 —— 任何一个单 agent 的 run
  // 只要跑到交付，泳道数就必然超过 2，于是**每一个跑完的 run 都会翻回画布**，
  // 「步骤轨是默认视图」这个决定就形同虚设。而单 agent 的事件图是一条直线，
  // 用图渲染器画直线、还占掉整个舞台，正是这次重排要解决的问题。
  //
  // 执行者的判定与 liveBoard.projectLiveBoard 里的 `agents` 同源：direction='A' 且不是 Driver 泳道。
  const agentLaneCount = new Set(
    nodes.filter((n) => n.direction === 'A' && n.lane !== 'Driver').map((n) => n.lane),
  ).size;
  const effectiveView = view ?? (agentLaneCount > 1 ? 'canvas' : 'rail');

  const railNodes = nodes.filter((n) => showMachineSteps || n.tier !== 'machine');
  const activeNodeId = selectedNodeId ?? nodes.find((n) => n.status === 'active')?.id ?? null;

  // 产出（agent 真写出来的文件）—— 舞台的主角。右栏不再重复渲染它（一个事实只有一个宿主）。
  const artifacts = artifactFactsOf(liveRun);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[#2a3142] px-5 py-4">
          <Breadcrumb
            projectName={activeProject?.name ?? '当前项目'}
            taskTitle={activeTask?.title ?? '未命名需求'}
          />

          <MissionLine
            state={state}
            headline={mission.headline}
            sub={mission.sub}
            workspacePath={liveRun ? workspace || undefined : undefined}
            channel={eventChannelStatus}
            onRetry={mission.retry ? onRetry : undefined}
            onRevealWorkspace={() => {
              if (workspace) revealAgentFile(workspace);
            }}
          />

          <ProgressRibbon phases={phaseSegments(nodes, activeNodeId ?? undefined)} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-end px-5 pt-2">
            <ViewMenu
              canvas={effectiveView === 'canvas'}
              showMachineSteps={showMachineSteps}
              onToggleCanvas={() => {
                setView(effectiveView === 'canvas' ? 'rail' : 'canvas');
              }}
              onToggleMachineSteps={() => {
                setShowMachineSteps((v) => !v);
              }}
            />
          </div>

          {/*
            舞台 = 步骤轨（贴顶，内容多高就多高）+ 产出面（占满剩下的空间）。
            步骤轨本身只有 ~120px；此前它独占一个 flex-1 容器，底下是 500px 真空。
            那不是「没填满」，是舞台失去了职责 —— 顶部管状态、右栏管详情、Dock 管原始文本，
            舞台没活干了。现在它接手整个产品最重要的那个事实：agent 到底写出了什么。
            选了「图」视图时舞台整个让给画布 —— 那是用户明确要看结构。
          */}
          <div className="relative flex min-h-0 flex-1 flex-col px-5 pb-2">
            {nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState
                  icon={Workflow}
                  title="尚未执行"
                  hint="开始后，Agent 的每一步会在这里出现。"
                />
              </div>
            ) : effectiveView === 'canvas' ? (
              <div className="h-full">
                <WorkflowCanvas showMachineSteps={showMachineSteps} />
              </div>
            ) : (
              <>
                <div className="shrink-0">
                  <StepRail nodes={railNodes} activeId={activeNodeId} onSelect={selectNode} />
                </div>
                <div className="min-h-0 flex-1">
                  <OutputStage facts={artifacts} state={state} />
                </div>
              </>
            )}
          </div>
        </div>

        <PrimaryAction
          state={state}
          retrying={retrying}
          error={retryError}
          onStart={startTask}
          onUseRecommended={useRecommendedWorkflow}
          onRetry={onRetry}
        />
      </div>

      <RunFoldColumn />
    </div>
  );
}

/** 步骤轨右上角的 `⋯ 视图`：两个开关，都只影响这一屏怎么看，不影响这次 run 是什么。 */
function ViewMenu({
  canvas,
  showMachineSteps,
  onToggleCanvas,
  onToggleMachineSteps,
}: {
  canvas: boolean;
  showMachineSteps: boolean;
  onToggleCanvas: () => void;
  onToggleMachineSteps: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden /> 视图
      </Button>

      {open && (
        <div className="absolute right-0 top-9 z-10 w-56 rounded-panel border border-[#2a3142] bg-surface-panel py-1">
          <MenuToggle checked={canvas} onClick={onToggleCanvas}>
            图
          </MenuToggle>
          <MenuToggle checked={showMachineSteps} onClick={onToggleMachineSteps}>
            显示机器握手步骤
          </MenuToggle>
        </div>
      )}
    </div>
  );
}

function MenuToggle({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-fg-secondary transition-colors hover:bg-surface-raised hover:text-fg-primary"
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          checked ? 'bg-command' : 'border border-fg-faint',
        )}
      />
      {children}
    </button>
  );
}

/** 项目里还一条需求都没有 —— 这一屏只该有一个动作。 */
function NoTaskBoard() {
  const [reqOpen, setReqOpen] = useState(false);
  const projects = useDemoStore((s) => s.projects);
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={FilePlus2}
        title={`${activeProject?.name ?? '当前项目'} · 还没有需求`}
        hint="写一条需求，Agent 会接手并把文件写进这个项目。"
        action={
          <Button
            variant="primary"
            onClick={() => {
              setReqOpen(true);
            }}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden /> 新建需求
          </Button>
        }
      />
      <NewRequirementDialog
        open={reqOpen}
        onClose={() => {
          setReqOpen(false);
        }}
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { CouncilFold } from '@/components/run/folds/CouncilFold';
import { DeliveryFold } from '@/components/run/folds/DeliveryFold';
import { MachineHandshakeFold } from '@/components/run/folds/MachineHandshakeFold';
import { NeedsYouFold } from '@/components/run/folds/NeedsYouFold';
import { ProtocolFlowFold } from '@/components/run/folds/ProtocolFlowFold';
import { RequirementFold } from '@/components/run/folds/RequirementFold';
import { RunInfoFold } from '@/components/run/folds/RunInfoFold';
import { StepFold } from '@/components/run/folds/StepFold';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import {
  artifactFactsOf,
  blockingGateOf,
  councilFactsOf,
  eventsByNode,
  focusStepOf,
  machineSteps,
  runMetaOf,
} from '@/lib/runFacts';
import { projectProtocolFlow } from '@/lib/protocolFlow';
import { runStateOf } from '@/lib/runState';
import { useResizablePane } from '@/lib/useResizablePane';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';
import type { DemoState } from '@/store/types';
import { cn } from '@/lib/utils';

const selectActiveTask = (s: DemoState) => s.tasks.find((t) => t.id === s.activeTaskId);

/** 窗口窄到这个宽度以下，右栏自动收起 —— 中区（主句 + 步骤轨）优先。 */
const NARROW = '(max-width: 1119px)';

/**
 * 右栏 —— **没有标题、没有 tab，就是一列 Fold**，顺序固定：
 * 步骤 / 产出文件 / 需要你 / 议会 / 交付 / 机器握手 / 协议流程 / 需求 / 运行信息。
 * （议会只在 council 事件真的发生过时出现 —— 单 agent run 没有这一条；
 * 协议流程是 N0–N18 的事件点亮图，只在有真实 run 时出现。）
 *
 * 它取代的是：`LiveRunPanel`（把 L1 的工作区路径和 L3 的 22 条事件焊在一起）、
 * `NodeInspector`（标题写死「节点详情」，里面却四选一渲染 —— 标题在说谎）、
 * `NodeExecutionLog`、`FileOpsPanel`（`nodeFileOps` 在真实 run 里恒空 —— R2）、`DeliveryReport`。
 *
 * **三处事件转储在这里被处决**：原始事件不再有任何一处内嵌展开面板，
 * 每个 Fold 的 D2 末尾只有那一行 `原始事件 · {n} 条 ↗`（由 `Fold` 自己渲染，措辞不靠自律），
 * 点它 → Dock 的事件流频道（L3 的唯一物理出口）。
 */
export function RunFoldColumn() {
  const task = useDemoStore(selectActiveTask);
  // 必须走 selectActiveLiveRun：直接读 liveRuns 再自己比对 runId 的写法已经出过事 ——
  // 并发跑第二个需求时，会把另一次 run 的状态/事件数安在当前任务头上。
  const live = useDemoStore(selectActiveLiveRun);
  const openEvidence = useDemoStore((s) => s.openEvidence);
  const setPage = useDemoStore((s) => s.setPage);

  const { size, collapsed, setCollapsed, onResizeStart } = useResizablePane({
    side: 'right',
    defaultSize: 380,
    minSize: 280,
    maxSize: 560,
    storageKey: 'foldcol',
  });

  // 窄窗口自动收起（minWidth: 1024 必须成立）。收起后用户仍可手动展开 —— 这是他的机器。
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const apply = (matches: boolean) => {
      if (matches) setCollapsed(true);
    };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      apply(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [setCollapsed]);

  const [reqOpen, setReqOpen] = useState(false);

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-edge bg-surface-deck py-2">
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
          }}
          title="展开右栏"
          className="rounded-chip p-1 text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg-primary"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      </aside>
    );
  }

  const nodes = task?.nodes ?? [];
  const timeline = live?.timeline ?? [];
  const runState = runStateOf(task, live);
  const byNode = eventsByNode(timeline);
  const step = focusStepOf(nodes, task?.selectedNodeId ?? null);
  const machine = machineSteps(nodes);
  const gate = blockingGateOf(timeline);
  const artifacts = artifactFactsOf(live);
  const council = councilFactsOf(live);

  const snapshot = live?.snapshot;
  const report = snapshot && isFrontendWorkflowV01(snapshot) ? snapshot.delivery_report : undefined;

  /** 某个步骤背后的事件条数（Fold 底部那一行 L3 入口的 n）。 */
  const countOf = (nodeId: string | undefined) => (nodeId ? (byNode[nodeId]?.length ?? 0) : 0);
  /** 某个语义步骤的节点 id（用于把 L3 过滤到这一步）。 */
  const idOfStep = (key: string) => nodes.find((n) => n.id.startsWith(`step-${key}|`))?.id;

  const openStep = (stepId: string) => {
    openEvidence(stepId);
  };
  const openStepOrAll = (key: string) => () => {
    openEvidence(idOfStep(key) ?? null);
  };

  return (
    <aside
      style={{ width: size }}
      className="relative flex shrink-0 flex-col border-l border-edge bg-surface-deck"
    >
      {/* 拖拽把手：右栏在 280–560 之间可调 */}
      <div
        role="presentation"
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-edge-strong"
      />
      <div className="flex justify-end px-1 pt-1">
        <button
          type="button"
          onClick={() => {
            setCollapsed(true);
          }}
          title="收起右栏"
          className="rounded-chip p-1 text-fg-faint transition-colors hover:bg-surface-raised hover:text-fg-primary"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className={cn('flex-1 overflow-y-auto', 'border-t border-edge')}>
        {!task ? (
          <EmptyState
            icon={Inbox}
            title="还没有需求"
            hint="新建一条需求，Agent 的每一步都会出现在这里。"
          />
        ) : (
          <>
            {step && (
              <StepFold node={step} events={byNode[step.id] ?? []} onOpenEvidence={openStep} />
            )}

            {/*
              「产出文件」原本是这里的一个折叠条 —— 但那是整个产品最重要的事实，
              权重不该和「机器握手」并列。它已经搬到中央舞台（OutputStage），
              这里**不再重复渲染**（R1：一个事实只有一个宿主）。
              这一步的原始事件入口没有丢：从步骤轨点「产出」那张卡 → 上面的 StepFold 就给出入口。
            */}

            {gate && (
              <NeedsYouFold
                gate={gate}
                eventCount={countOf(idOfStep('review'))}
                onOpenEvidence={openStepOrAll('review')}
              />
            )}

            {council && (
              <CouncilFold
                facts={council}
                eventCount={countOf(idOfStep('council'))}
                onOpenEvidence={openStepOrAll('council')}
                onOpenBoard={() => {
                  setPage('council');
                }}
              />
            )}

            {runState === 'completed' && report && (
              <DeliveryFold
                facts={{
                  worktreePath: report.worktree_path ?? '',
                  fileCount: artifacts.count,
                  artifactsMaterialized: report.artifacts_materialized,
                }}
                eventCount={countOf(idOfStep('deliver'))}
                onOpenEvidence={openStepOrAll('deliver')}
                onNewRequirement={() => {
                  setReqOpen(true);
                }}
              />
            )}

            {machine.length > 0 && (
              <MachineHandshakeFold
                nodes={machine}
                eventsByNodeId={byNode}
                onOpenEvidence={openStep}
                onOpenAllEvidence={() => {
                  openEvidence(null);
                }}
              />
            )}

            {live && timeline.length > 0 && (
              <ProtocolFlowFold
                nodes={projectProtocolFlow(timeline, live.status)}
                eventCount={timeline.length}
                onOpenEvidence={() => {
                  openEvidence(null);
                }}
              />
            )}

            <RequirementFold
              text={task.taskText}
              completionCriteria={task.completionCriteria ?? []}
              evidence={
                live
                  ? {
                      count: countOf(idOfStep('intake')),
                      onOpen: openStepOrAll('intake'),
                    }
                  : undefined
              }
            />

            {live && (
              <RunInfoFold
                meta={runMetaOf(live)}
                onOpenEvidence={() => {
                  openEvidence(null);
                }}
              />
            )}
          </>
        )}
      </div>

      <NewRequirementDialog
        open={reqOpen}
        onClose={() => {
          setReqOpen(false);
        }}
      />
    </aside>
  );
}

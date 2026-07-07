import { useState } from 'react';
import {
  Play,
  Workflow,
  StepForward,
  FastForward,
  Hand,
  Scale,
  FileCheck2,
  Square,
  Target,
  FolderTree,
  FlaskConical,
  ShieldAlert,
  Sparkles,
  FilePlus2,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import { ExecutionTimeline } from '@/components/ExecutionTimeline';
import { NodeInspector } from '@/components/NodeInspector';
import { InterveneDialog } from '@/components/InterveneDialog';
import { NewRequirementDialog } from '@/components/NewRequirementDialog';
import { DeliveryReport } from '@/components/DeliveryReport';
import { SidePanel } from '@/components/SidePanel';
import { deriveScenario } from '@/data/scenario';
import type { DemoStage } from '@/types';

const stageBadge: Record<
  DemoStage,
  { label: string; variant: 'slate' | 'blue' | 'amber' | 'violet' | 'green' }
> = {
  idle: { label: '待组队', variant: 'slate' },
  team_configured: { label: '团队就绪', variant: 'blue' },
  analyzing: { label: '需求分析中', variant: 'blue' },
  workflow_recommended: { label: '已推荐流程', variant: 'blue' },
  executing: { label: '执行中', variant: 'blue' },
  intervention: { label: '用户介入', variant: 'amber' },
  council: { label: '议会裁决中', variant: 'violet' },
  delivery: { label: '已交付', variant: 'green' },
};

export function TaskBoard() {
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  if (!activeTaskId) return <NoTaskBoard />;
  return <TaskBoardInner />;
}

function TaskBoardInner() {
  const stage = useDemoStore((s) => s.stage);
  const taskText = useDemoStore((s) => s.taskText);
  const setTaskText = useDemoStore((s) => s.setTaskText);
  const startTask = useDemoStore((s) => s.startTask);
  const useRecommendedWorkflow = useDemoStore((s) => s.useRecommendedWorkflow);
  const nextStep = useDemoStore((s) => s.nextStep);
  const autoRun = useDemoStore((s) => s.autoRun);
  const stopAutoRun = useDemoStore((s) => s.stopAutoRun);
  const goToCouncil = useDemoStore((s) => s.goToCouncil);
  const showDelivery = useDemoStore((s) => s.showDelivery);
  const isAutoRunning = useDemoStore((s) => s.isAutoRunning);
  const nodes = useDemoStore((s) => s.nodes);
  const activeStepIndex = useDemoStore((s) => s.activeStepIndex);
  const assignedAgentIds = useDemoStore((s) => s.assignedAgentIds);
  const activeTaskId = useDemoStore((s) => s.activeTaskId);
  const tasks = useDemoStore((s) => s.tasks);
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  const replay = useDemoStore(selectActiveReplay);

  const [interveneOpen, setInterveneOpen] = useState(false);

  const activeNode = stage === 'executing' && activeStepIndex >= 0 ? nodes[activeStepIndex] : null;

  const showStart = stage === 'idle' || stage === 'team_configured';
  const showRecommend = stage === 'analyzing' || stage === 'workflow_recommended';
  const showExecuteControls = stage === 'executing';
  // 用 code 判断（并行执行段节点 id 带 -be/-te 后缀，code 仍为 N7）
  const showIntervene = activeNode?.code === 'N7';
  // 回放任务 Gate=allow：本次 run 未触发 Council，不提供入口
  const showCouncil =
    (activeNode?.code === 'N13' || activeNode?.code === 'N14') && replay?.gateDecision !== 'allow';
  const showDelivered = stage === 'delivery';

  const hasWorkflow = stage !== 'idle' && stage !== 'team_configured' && stage !== 'analyzing';

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Command Bar */}
        <div className="border-b border-line px-5 py-4">
          <div className="mb-2 flex items-center gap-3">
            <div className="callsign text-[10px] text-command-soft">// 02 · 执行</div>
            <h1 className="font-display text-lg font-semibold tracking-tight text-white">
              {activeTask?.title ?? 'Task Board'}
            </h1>
            <Badge variant={stageBadge[stage].variant}>{stageBadge[stage].label}</Badge>
            {/* N2 受理遥测：后端（C）回填权威 task_id 前显示本地态 */}
            {activeTask?.contractTaskId ? (
              <span className="callsign text-[9px] text-emerald-300/80">
                COORD · {activeTask.contractTaskId}
              </span>
            ) : (
              <span className="callsign text-[9px] text-slate-500">COORD · 本地 · 未受理</span>
            )}
            {/* 回放任务按真实 run 的 mode 组队（single_agent=1 人），不提示人数 */}
            {!replay && assignedAgentIds.length < 3 && (
              <span className="text-xs text-human/80">
                当前团队人数不足（建议至少 3 名）。可前往 Agent Board → 自定义团队
              </span>
            )}
            {replay && (
              <span className="callsign text-[9px] text-slate-500">
                MODE · {replay.snapshot.run.mode} · driver={replay.snapshot.run.driver_id}
              </span>
            )}
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="callsign mb-1 block text-[9px] text-slate-500">
                任务描述 · DIRECTIVE
              </label>
              <Textarea
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                rows={2}
                disabled={stage !== 'idle' && stage !== 'team_configured'}
                className="disabled:opacity-70"
              />
            </div>
            <div className="flex flex-col gap-2 pb-0.5">
              {showStart && (
                <Button variant="primary" onClick={startTask}>
                  <Play className="h-4 w-4" /> Start Task
                </Button>
              )}
              {showRecommend && (
                <Button variant="primary" onClick={useRecommendedWorkflow}>
                  <Workflow className="h-4 w-4" /> Use Recommended Workflow
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Canvas / placeholder */}
        <div className="relative min-h-0 flex-1">
          {hasWorkflow ? <WorkflowCanvas /> : <EmptyCanvas stage={stage} />}
        </div>

        {/* Execution timeline */}
        <ExecutionTimeline />

        {/* Demo Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-ink-900/60 px-5 py-3">
          <span className="callsign mr-1 text-[9px] text-slate-500">▸ DEMO CONTROLS</span>

          {showExecuteControls && (
            <>
              <Button variant="secondary" size="sm" onClick={nextStep}>
                <StepForward className="h-4 w-4" /> Next Step
              </Button>
              {isAutoRunning ? (
                <Button variant="warning" size="sm" onClick={stopAutoRun}>
                  <Square className="h-4 w-4" /> 暂停
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={autoRun}>
                  <FastForward className="h-4 w-4" /> Auto Run
                </Button>
              )}
            </>
          )}

          {showIntervene && (
            <Button variant="warning" size="sm" onClick={() => setInterveneOpen(true)}>
              <Hand className="h-4 w-4" /> Intervene
            </Button>
          )}

          {showCouncil && (
            <Button variant="council" size="sm" onClick={goToCouncil}>
              <Scale className="h-4 w-4" /> Go to Council
            </Button>
          )}

          {showDelivered && (
            <Button variant="success" size="sm" onClick={showDelivery}>
              <FileCheck2 className="h-4 w-4" /> View Delivery Report
            </Button>
          )}

          {!showExecuteControls &&
            !showIntervene &&
            !showCouncil &&
            !showDelivered &&
            !showStart &&
            !showRecommend && (
              <span className="text-xs text-slate-600">根据流程进度自动显示可用操作</span>
            )}
        </div>
      </div>

      {/* Right column */}
      <SidePanel
        side="right"
        title="详情面板 · Inspector"
        defaultWidth={400}
        minWidth={300}
        maxWidth={620}
        storageKey="task-inspector"
      >
        {stage === 'delivery' ? (
          <DeliveryReport />
        ) : stage === 'analyzing' || stage === 'workflow_recommended' ? (
          <TaskUnderstandingPanel />
        ) : stage === 'idle' || stage === 'team_configured' ? (
          <IdleRightPanel />
        ) : (
          <NodeInspector />
        )}
      </SidePanel>

      <InterveneDialog open={interveneOpen} onClose={() => setInterveneOpen(false)} />
    </div>
  );
}

function NoTaskBoard() {
  const [reqOpen, setReqOpen] = useState(false);
  const projects = useDemoStore((s) => s.projects);
  const activeProjectId = useDemoStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-800 text-slate-500">
        <FilePlus2 className="h-8 w-8" />
      </div>
      <div>
        <div className="font-display text-lg font-semibold text-white">
          {activeProject?.name ?? '当前项目'} · 还没有任务
        </div>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          输入一条需求，Agent 会分析并推荐执行 Workflow。
        </p>
      </div>
      <Button variant="primary" onClick={() => setReqOpen(true)}>
        <FilePlus2 className="h-4 w-4" /> 新建需求
      </Button>
      <NewRequirementDialog open={reqOpen} onClose={() => setReqOpen(false)} />
    </div>
  );
}

function EmptyCanvas({ stage }: { stage: DemoStage }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-800 text-slate-500">
        <Workflow className="h-7 w-7" />
      </div>
      <div className="text-sm text-slate-400">
        {stage === 'analyzing'
          ? '需求分析完成，点击 “Use Recommended Workflow” 开始执行并逐步生成泳道图'
          : '输入任务并点击 “Start Task” 开始'}
      </div>
      <div className="text-xs text-slate-600">
        执行过程将沿 7 条责任方 Lane 动态生成 N0–N18 全链路节点
      </div>
    </div>
  );
}

function TaskUnderstandingPanel() {
  const useRecommendedWorkflow = useDemoStore((s) => s.useRecommendedWorkflow);
  const stage = useDemoStore((s) => s.stage);
  const taskText = useDemoStore((s) => s.taskText);
  const replay = useDemoStore(selectActiveReplay);
  // 回放任务用真实 run 的场景内容，普通任务按需求文本推导
  const understanding = (replay?.scenario ?? deriveScenario(taskText)).understanding;

  const rows = [
    {
      icon: Target,
      title: '需求目标',
      tone: 'text-blue-300',
      content: understanding.goal,
    },
    {
      icon: FolderTree,
      title: '涉及模块',
      tone: 'text-cyan-300',
      content: understanding.modules.join('、'),
    },
    {
      icon: FlaskConical,
      title: '测试目录',
      tone: 'text-emerald-300',
      content: understanding.testDir,
    },
    {
      icon: ShieldAlert,
      title: '潜在风险',
      tone: 'text-rose-300',
      content: understanding.risks.join('、'),
    },
    {
      icon: Sparkles,
      title: '推荐 Workflow',
      tone: 'text-violet-300',
      content: understanding.workflow,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800/80 p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-400" />
          <h2 className="text-base font-semibold text-white">Task Understanding</h2>
        </div>
        <p className="mt-1 text-xs text-slate-500">系统已完成需求结构化分析（mock）</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div
              key={r.title}
              className="rounded-lg border border-slate-800 bg-ink-900/60 p-3 animate-fade-in"
            >
              <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold ${r.tone}`}>
                <Icon className="h-3.5 w-3.5" />
                {r.title}
              </div>
              <p className="text-xs leading-relaxed text-slate-300">{r.content}</p>
            </div>
          );
        })}
      </div>

      {stage === 'analyzing' && (
        <div className="border-t border-slate-800/80 p-4">
          <Button variant="primary" className="w-full" onClick={useRecommendedWorkflow}>
            <Workflow className="h-4 w-4" /> Use Recommended Workflow
          </Button>
        </div>
      )}
    </div>
  );
}

function IdleRightPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
      <Play className="mb-3 h-10 w-10 text-slate-700" />
      <p className="text-sm">输入任务并点击 Start Task</p>
      <p className="text-xs text-slate-600">系统会先分析需求，再推荐多 Agent 执行流程</p>
    </div>
  );
}

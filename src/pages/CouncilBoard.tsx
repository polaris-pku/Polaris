import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BadgeCheck,
  FileCode2,
  FileText,
  Gavel,
  Link2,
  MessagesSquare,
  PackageCheck,
  RotateCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';
import { selectStartCouncil } from '@/store/slices/taskSlice';
import type { DemoState } from '@/store/types';
import { SidePanel } from '@/components/SidePanel';
import { ArtifactContentDialog } from '@/components/ArtifactContentDialog';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { Fold } from '@/components/ui/Fold';
import { IdChip } from '@/components/ui/IdChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { CouncilOutcome, CouncilVerdict, ReviewVerdict } from '@/api/types/council';
import {
  buildCouncilBoard,
  type CouncilAuctionBid,
  type CouncilAuctionCandidate,
  type CouncilAuctionCard,
  type CouncilBidScore,
  type CouncilBoardModel,
  type CouncilImplementationCard,
  type CouncilParticipantCard,
  type CouncilPrimarySelection,
  type CouncilProposalCard,
  type CouncilResultCard,
  type CouncilRoleFailure,
  type CouncilOutputCard,
} from '@/lib/councilBoard';
import { roleName } from '@/lib/roleNames';
import { cn } from '@/lib/utils';

/**
 * 合议 —— proposer / reviewer / synthesizer 裁决过程的**观察面板**。
 *
 * 数据完全来自真实 run：运行中由 market.* / council.* 事件逐步长出（谁被选进席位、
 * 谁正在做哪一阶段、谁提了案、谁在评审），终态用快照的 `snapshot.council` 补全正文
 * （提案 summary / 评审意见 / 综合结论 / 实施回复 / 结果与质量）。
 *
 * 阅读顺序（三栏之内的一条主线，不是三段平铺）：
 *   左栏 = 议前与过程  竞标 → 席位名册 → 议题 → 事件序
 *   中栏 = 提案         每位提案者一张卡，评审贴在它评的那份提案上
 *   右栏 = 结论         综合 → 实施 → 裁决 → 结果 → 交付与验证
 *
 * 【R4】这里**没有裁决按钮**：合议由后端 agent 自主完成，Polaris 没有把人工裁决送回
 * 后端的通道 —— 一个只改本地状态的「采纳」按钮会让用户以为自己影响了结果。
 * 唯一的动作是「再开一轮合议」，它背后有真实 RPC（task.startCouncil），所以它可以存在。
 */
export function CouncilBoard() {
  const setPage = useDemoStore((s) => s.setPage);
  const live = useDemoStore(selectActiveLiveRun);
  const activeTaskId = useDemoStore(selectActiveTaskId);
  const backendTaskId = useDemoStore(selectBackendTaskId);
  const startCouncil = useDemoStore(selectStartCouncil);

  // 产物正文查看器由本页持有：一个 run 里所有产物引用共用一个弹窗，artifactId 为 null 时它不渲染、不发 RPC。
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // 「再开一轮合议」的 pending / 后端原话。store 上没有全局 pending 标记，也不该有。
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const snapshot = live?.snapshot;
  const full = snapshot && isFrontendWorkflowV01(snapshot) ? snapshot : undefined;
  const model = live
    ? buildCouncilBoard(live.timeline, full?.council ?? undefined, full?.market)
    : null;
  const runId = live?.runId ?? '';

  if (!model) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Scale}
          title="本次任务未触发合议"
          hint="新建需求时选择「多 Agent 合议」，两份提案、评审与综合的全过程会出现在这里。"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPage('tasks');
              }}
            >
              返回任务
            </Button>
          }
        />
      </div>
    );
  }

  const statusBadge = STATUS_BADGE[model.status] ?? { label: model.status, variant: 'default' };
  const openArtifact = (artifactId: string) => {
    setOpenArtifactId(artifactId);
  };

  const reopen = async () => {
    if (!activeTaskId || reopening) return;
    setReopening(true);
    setReopenError(null);
    try {
      const result = await startCouncil(activeTaskId);
      if (!result.ok) setReopenError(result.error);
    } finally {
      setReopening(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 抬头：状态 + 决议标识（机器 ID 收进 IdChip）+ 当前谁在做什么 */}
      <header className="border-b border-edge px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-command-soft" />
          <h1 className="text-title text-fg-primary">合议</h1>
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          {model.decision?.decisionId && (
            <IdChip value={model.decision.decisionId} label="决议 ID" />
          )}
          {model.decisionMode && (
            <span className="text-body text-fg-muted">
              决策模式 <span className="font-mono text-code">{model.decisionMode}</span>
            </span>
          )}
          {model.failedCode && (
            <span className="font-mono text-code text-danger">{model.failedCode}</span>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">
          提案者各给出一份候选实现，评审员逐案评审，综合员产出最终候选 ——
          裁决由后端自主完成，这里呈现全过程。
        </p>
        <PhaseLine model={model} />
      </header>

      {/* 致命错误摆在最上面：出现它这一轮合议就中止了，不能藏在右栏里 */}
      {model.fatalError && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-6 py-3">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-danger-soft" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-title text-danger-soft">合议中止</span>
              <span className="font-mono text-code text-fg-faint">{model.fatalError.code}</span>
            </div>
            <p className="mt-1 text-body text-fg-secondary">
              {model.fatalError.message || '后端没有给出错误说明。'}
            </p>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左：议前与过程（竞标 → 名册 → 议题 → 事件序，全部真实数据） */}
        <SidePanel
          side="left"
          title="议前与过程"
          defaultWidth={320}
          minWidth={240}
          maxWidth={480}
          storageKey="council-feed"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={MessagesSquare}>议前与过程</PanelTitle>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AuctionSection auctions={model.auctions} primary={model.primarySelection} />
              <RosterFold
                participants={model.participants}
                selectionMode={model.participantSelectionMode}
              />
              <SubjectFold model={model} />
              <FeedFold feed={model.feed} />
            </div>
          </div>
        </SidePanel>

        {/* 中：提案（运行中是骨架，终态补全正文）；席位告警贴在提案上方解释「为什么少一份」 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelTitle icon={Scale}>提案 · {model.proposals.length}</PanelTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <RoleFailureList failures={model.roleFailures} />
            <div className="grid grid-cols-1 content-start gap-4 xl:grid-cols-2">
              {model.proposals.length === 0 && (
                <p className="text-body text-fg-muted">
                  提案者还在起草 —— 提案完成后会出现在这里。
                </p>
              )}
              {model.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.proposalId}
                  proposal={proposal}
                  onOpenArtifact={openArtifact}
                />
              ))}
            </div>
          </div>
        </div>

        {/* 右：综合 → 实施 → 裁决 → 结果（只读） */}
        <SidePanel
          side="right"
          title="综合与裁决"
          defaultWidth={340}
          minWidth={280}
          maxWidth={520}
          storageKey="council-decision"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={Gavel}>综合与裁决</PanelTitle>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* 综合 */}
              <div>
                <SectionLabel icon={Sparkles}>综合</SectionLabel>
                {model.synthesis ? (
                  <div className="rounded-panel border border-edge bg-surface-panel p-3">
                    <div className="text-body text-fg-primary">
                      {roleName(model.synthesis.roleId)}
                    </div>
                    {model.synthesis.summary ? (
                      <p className="mt-1 text-body text-fg-secondary">{model.synthesis.summary}</p>
                    ) : (
                      <p className="mt-1 text-body text-fg-muted">正文随终态快照到达。</p>
                    )}
                    <div className="mt-2">
                      <IdChip value={model.synthesis.synthesisId} label="综合 ID" />
                    </div>
                    {/* 摘要之外的全文在产物里 —— 点开就是完整正文 */}
                    <ArtifactRefs
                      refs={model.synthesis.artifactRefs}
                      label="方案全文"
                      onOpen={openArtifact}
                    />
                  </div>
                ) : (
                  <p className="text-body text-fg-muted">
                    {model.status === 'running' ? '综合还未开始。' : '本次合议没有综合产出。'}
                  </p>
                )}
              </div>

              {/* 实施：只有 plan_first 才有这一段 */}
              {(model.implementation || model.artifactMode === 'plan') && (
                <div>
                  <SectionLabel icon={Wrench}>实施</SectionLabel>
                  {model.implementation ? (
                    <ImplementationBlock
                      implementation={model.implementation}
                      onOpenArtifact={openArtifact}
                    />
                  ) : (
                    <p className="text-body text-fg-muted">
                      主 Agent 还没有按最终方案实施 —— 这一轮产出的是方案，不是代码改动。
                    </p>
                  )}
                </div>
              )}

              {/* 裁决 */}
              <div>
                <SectionLabel icon={Gavel}>裁决</SectionLabel>
                {model.decision ? (
                  <div className="rounded-panel border border-edge bg-surface-panel p-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          (badgeOf(VERDICT_BADGE, model.decision.verdict) ?? DEFAULT_VERDICT)
                            .variant
                        }
                      >
                        {(badgeOf(VERDICT_BADGE, model.decision.verdict) ?? DEFAULT_VERDICT).label}
                      </Badge>
                      {/* 协议原文只作灰色注解 */}
                      <span className="font-mono text-code text-fg-faint">
                        {model.decision.verdict}
                      </span>
                    </div>
                    {model.decision.selectedProposalId && (
                      <div className="mt-2 flex items-center gap-2 text-body text-fg-secondary">
                        选中提案
                        <IdChip value={model.decision.selectedProposalId} />
                      </div>
                    )}
                    {/* live 路径唯一的说理字段是 reason；termination_reason 只有 legacy 流程发 */}
                    {(model.decision.reason || model.decision.terminationReason) && (
                      <p className="mt-1 text-body text-fg-secondary">
                        裁决理由：{model.decision.reason || model.decision.terminationReason}
                      </p>
                    )}
                    <ArtifactRefs
                      refs={model.decision.selectedArtifactRefs}
                      label="选中产物"
                      onOpen={openArtifact}
                    />
                  </div>
                ) : (
                  <p className="text-body text-fg-muted">
                    {model.status === 'running' ? '裁决还未产生。' : '本次合议没有产生裁决。'}
                  </p>
                )}
              </div>

              {/* 结果：后端的稳定结论信封 */}
              {model.outcome && <OutcomeBlock outcome={model.outcome} />}

              {/* 交付与验证：质量存证 */}
              {model.result && (
                <ResultBlock
                  result={model.result}
                  hasOutcome={model.outcome !== null}
                  onOpenArtifact={openArtifact}
                />
              )}

              {/* 交付信封：各席位各自产出了哪些文件 */}
              {model.output && <OutputBlock output={model.output} onOpenArtifact={openArtifact} />}

              {/* 后续动作 / 阻塞项（后端要求的，只告知） */}
              {model.requiredNextActions.length > 0 && (
                <div>
                  <div className="mb-1.5 text-body text-fg-muted">后续动作</div>
                  <ul className="space-y-1">
                    {model.requiredNextActions.map((action) => (
                      <li key={action} className="text-body text-fg-secondary">
                        · {action}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {model.blockedBy.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1 text-body text-danger">
                    <AlertTriangle className="h-3 w-3" /> 阻塞项
                  </div>
                  <ul className="space-y-1">
                    {model.blockedBy.map((item) => (
                      <li key={item} className="font-mono text-code text-fg-secondary">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/*
              唯一的动作。它能存在，是因为 `task.startCouncil` 是一条真实 RPC ——
              而「采纳 / 驳回」至今没有回写通道，所以那两个按钮仍然不存在。
            */}
            <div className="space-y-2 border-t border-edge p-4">
              {model.status === 'running' ? (
                <p className="text-body text-fg-muted">合议进行中，结束后可以再开一轮。</p>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={!backendTaskId || reopening}
                    onClick={() => void reopen()}
                  >
                    <RotateCw className="h-4 w-4" />
                    {reopening ? '正在请求…' : '再开一轮合议'}
                  </Button>
                  <p className="text-body text-fg-muted">
                    {backendTaskId
                      ? '后端会用同一份需求重新发起合议：这次 run 已结束就新起一次 run，还在执行中则把它转入合议。'
                      : '这个任务还没有被后端受理，暂时开不了新一轮。'}
                  </p>
                </>
              )}
              {/* 后端拒绝时把原话摆出来，不改写、不吞掉 */}
              {reopenError && (
                <div className="flex items-start gap-2 rounded-panel border border-human/30 bg-human/5 px-3 py-2">
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-human-soft" />
                  <p className="whitespace-pre-line text-body text-fg-secondary">{reopenError}</p>
                </div>
              )}
              <p className="text-body text-fg-muted">
                裁决由后端 agent 自主完成，Polaris 没有把人工裁决送回后端的通道 ——
                所以这里不会有「采纳 / 驳回」按钮。
              </p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setPage('tasks');
                }}
              >
                <ArrowLeft className="h-4 w-4" /> 返回任务
              </Button>
            </div>
          </div>
        </SidePanel>
      </div>

      {/* 产物正文查看器：全页一个，artifactId 为 null 时什么都不渲染 */}
      {runId && (
        <ArtifactContentDialog
          runId={runId}
          artifactId={openArtifactId}
          onClose={() => {
            setOpenArtifactId(null);
          }}
        />
      )}
    </div>
  );
}

// ── store 选择器 ──

const selectActiveTaskId = (s: DemoState) => s.activeTaskId;
/** 后端受理后才有的 task_id；没有它 task.startCouncil 无从谈起。 */
const selectBackendTaskId = (s: DemoState) =>
  s.tasks.find((t) => t.id === s.activeTaskId)?.contractTaskId ?? '';

// ── 词表（主层说人话，协议原文只作灰色注解）──

/** `council.output.status` 的词表；认不出来的原样透出。 */
const OUTPUT_STATUS_LABEL: Record<string, string> = {
  selected: '已选定交付',
  needs_human: '需要人工介入',
  request_revision: '要求修订',
  rejected: '已否决',
};

const STATUS_BADGE: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  running: { label: '合议进行中', variant: 'command' },
  completed: { label: '合议完成', variant: 'ok' },
  failed: { label: '合议失败', variant: 'danger' },
  cancelled: { label: '合议已取消', variant: 'default' },
};

type VerdictBadge = { label: string; variant: BadgeProps['variant'] };

const DEFAULT_VERDICT: VerdictBadge = { label: '裁决', variant: 'default' };

/**
 * 裁决词表。键类型锚在契约的 `CouncilVerdict` 上 —— 后端改词表，这里编译不过。
 *
 * **它保证的是「词表覆盖」，不是「数据合法」**：`RunSnapshot.council.verdict` 已同步收紧到
 * 同一个类型（见 api/types/rpc.ts），所以两端一起动；但 RPC 边界是不可信 JSON，
 * 类型只是「后端声称会发什么」。真发来词表外的值时走下面的运行时兜底。
 *
 * （曾经这个哨兵是 api/map.ts 的 `UI_TO_CONTRACT_COUNCIL_VERDICT`，锚在一个写错的契约类型上，
 * 后端从没发过那三个值，所以它从来没响过。）
 *
 * `select` 不叫「采纳方案」：实测后端在 synthesis 流程里发 `select` 时**不带**
 * `selected_proposal_id` —— 采纳的是综合产出的最终候选，不是某一份原始提案。
 */
const VERDICT_BADGE: Record<CouncilVerdict, VerdictBadge> = {
  select: { label: '采纳候选', variant: 'ok' },
  needs_human: { label: '需要人工', variant: 'human' },
  request_revision: { label: '要求修改', variant: 'human' },
  reject: { label: '拒绝', variant: 'danger' },
};

/**
 * 评审词表。同样是**词表覆盖**保证：快照里的 `reviews` 整体是 `Record<string, unknown>`
 * （嵌套记录形状未定，由 buildCouncilBoard 逐字段防御性取值），所以这里拿到的是裸 string，
 * 编译期约束不到它 —— 兜底同下。
 */
const REVIEW_BADGE: Record<ReviewVerdict, VerdictBadge> = {
  approve: { label: '通过', variant: 'ok' },
  needs_revision: { label: '需修改', variant: 'human' },
  reject: { label: '拒绝', variant: 'danger' },
};

/** `council.outcome.status` —— 后端 3 值枚举。 */
const OUTCOME_BADGE: Record<string, VerdictBadge> = {
  completed: { label: '已完成', variant: 'ok' },
  needs_human: { label: '需要人工', variant: 'human' },
  failed: { label: '失败', variant: 'danger' },
};

/** 后端原文可能是词表外的新取值 —— 运行时兜底，不让界面崩在一个陌生字符串上。 */
const badgeOf = (table: Record<string, VerdictBadge>, verdict: string): VerdictBadge | undefined =>
  table[verdict];

const EVENT_LABEL: Record<string, string> = {
  'council.started': '合议开始',
  'council.participants.selected': '席位确定',
  'council.phase.started': '阶段开始',
  'council.proposal.completed': '提案完成',
  'council.review.completed': '评审完成',
  'council.synthesis.completed': '综合完成',
  'council.implementation.completed': '实施完成',
  'council.role.failed': '席位失败',
  'council.decision': '裁决产生',
  'council.completed': '合议结束',
  'council.failed': '合议失败',
};

const PHASE_LABEL: Record<string, string> = {
  selecting: '选人',
  proposal: '提案',
  review: '评审',
  synthesis: '综合',
  implementation: '实施',
  decision: '裁决',
  completed: '已结束',
  failed: '已失败',
};

const SEAT_LABEL: Record<string, string> = {
  proposer: '提案者',
  reviewer: '评审员',
  synthesizer: '综合员',
};

const SCOPE_LABEL: Record<string, string> = {
  primary: '主执行席位',
  council_seat: '合议席位',
};

/** `market.auction.*` 的 selection_mode —— 只有这两个取值。 */
const AUCTION_MODE_LABEL: Record<string, string> = {
  auction: '竞标抽签',
  fixed: '固定指派',
};

/** `council.participants.selected` 的 selection_mode —— 四个取值，只有 auction 跑了抽签。 */
const ROSTER_MODE_LABEL: Record<string, string> = {
  explicit: '调用方直接指定',
  fixed: '固定席位配置',
  auction: '竞标抽签',
  board_order: '按名册顺序',
};

const STRATEGY_LABEL: Record<string, string> = {
  classic: '经典三席',
  adaptive_lead: '自适应主导',
  plan_first: '先定方案再实施',
};

const ARTIFACT_MODE_LABEL: Record<string, string> = {
  plan: '最终方案（不直接改代码）',
  implementation: '直接实施',
};

/** live 路径发前三个，后四个是 legacy 流程的取值。 */
const TRIGGER_LABEL: Record<string, string> = {
  explicit_mode: '建任务时选了合议',
  persistent_override: '任务被标记为合议',
  agent_request: 'Agent 主动升级',
  user_choice: '用户选择',
  agent_escalate: 'Agent 升级',
  gate_defer: '闸口移交',
  manual: '人工发起',
};

const QUALITY_LABEL: Record<string, string> = {
  verified: '已验证',
  best_effort: '尽力而为',
};

const ROLE_FAILURE_LABEL: Record<string, string> = {
  COUNCIL_PROPOSAL_FAILED: '提案阶段失败',
  COUNCIL_REVIEW_FAILED: '评审阶段失败',
  COUNCIL_SYNTHESIS_FAILED: '综合阶段失败',
};

/** 词表兜底：认不出来就把后端原文摆出来，不编造。 */
const labelOf = (table: Record<string, string>, key: string): string => table[key] ?? key;

/** 后端没给这个数（null）时的占位。**不补 0** —— 0 在打分和概率里是有意义的真值。 */
const NA = '—';

const score2 = (v: number | null): string => (v === null ? NA : v.toFixed(2));
const pctOf = (v: number | null): string => (v === null ? NA : `${Math.round(v * 100)}%`);
const intOf = (v: number | null): string => (v === null ? NA : `${v}`);

// ── 抬头：当前谁在做什么 ──

/**
 * 阶段指示条。`phase` 是后端投影器给的当前阶段，`activePhase` 是最后一条
 * `council.phase.started` —— 两者合起来才是「谁正在做什么」。
 */
function PhaseLine({ model }: { model: CouncilBoardModel }) {
  if (!model.phase && !model.activePhase) return null;
  const active = model.activePhase;
  // 席位变体带 seat/agent_id，implementation 变体只有 role_id/agent_id —— 取不到的那半边留空。
  const actor = active ? active.agentId || active.roleId : '';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-body text-fg-muted">
        {model.status === 'running' ? '当前阶段' : '最终阶段'}
      </span>
      {model.phase ? (
        <>
          <Badge variant={model.status === 'running' ? 'command' : 'default'}>
            {labelOf(PHASE_LABEL, model.phase)}
          </Badge>
          <span className="font-mono text-code text-fg-faint">{model.phase}</span>
        </>
      ) : (
        <span className="text-body text-fg-muted">后端还没报阶段。</span>
      )}
      {active && (
        <span className="text-body text-fg-secondary">
          {model.status === 'running' ? '执行中 ' : '最后一步 '}
          {/* 终态时 phase 已经是 completed/failed，最后那步做的是什么得由事件自己说 */}
          {active.phase &&
            active.phase !== model.phase &&
            `${labelOf(PHASE_LABEL, active.phase)} · `}
          {active.seat && `${labelOf(SEAT_LABEL, active.seat)} · `}
          {actor ? roleName(actor) : '执行者未给'}
          {/* attempt 只有 synthesis 会 >1（后端 maxRounds = 2）；恒为 1 时显示它是噪音 */}
          {active.attempt !== null && active.attempt > 1 && ` · 第 ${active.attempt} 次尝试`}
          <span className="text-fg-faint"> · {active.time}</span>
        </span>
      )}
    </div>
  );
}

// ── 左栏：竞标 ──

function AuctionSection({
  auctions,
  primary,
}: {
  auctions: CouncilAuctionCard[];
  primary: CouncilPrimarySelection | null;
}) {
  if (auctions.length === 0) {
    return (
      <Fold
        id="council-auction-none"
        title="选人竞标"
        fact={primary ? '只留下了选人结果' : '本次没有竞标'}
      >
        {primary ? (
          <PrimarySelectionBlock primary={primary} />
        ) : (
          <p className="text-body text-fg-muted">
            本次合议没有竞标记录 —— 席位不是抽签定的，或者后端关掉了竞标。
          </p>
        )}
      </Fold>
    );
  }
  /**
   * 主席位的结果指纹要不要单独再列一条。
   *
   * 不能只比 auction_id：`market.selected` 只有真跑了竞标才带 auction_id，而
   * `snapshot.market` 连这个键都不投影 —— 从终态快照回放时它恒为空串。所以主席位那一场
   * 竞标只要在 `auctions` 里（selection_scope === 'primary'），这条就已经被覆盖了，
   * 再列一遍就是把同一个赢家印两次。
   */
  const primaryCovered =
    primary !== null &&
    auctions.some((a) => a.selectionScope === 'primary' || a.auctionId === primary.auctionId);
  return (
    <>
      {auctions.map((auction, i) => (
        <AuctionFold
          key={auction.auctionId}
          auction={auction}
          index={i}
          defaultOpen={auctions.length === 1}
        />
      ))}
      {/* 竞标过程之外的那份结果指纹：老 run / 关掉竞标的 run 只有它 */}
      {primary && !primaryCovered && (
        <Fold
          id="council-primary-selection"
          title="主执行席位"
          fact={roleName(primary.winnerAgentId)}
        >
          <PrimarySelectionBlock primary={primary} />
        </Fold>
      )}
    </>
  );
}

function AuctionFold({
  auction,
  index,
  defaultOpen,
}: {
  auction: CouncilAuctionCard;
  index: number;
  defaultOpen: boolean;
}) {
  const title = auction.seat
    ? `${labelOf(SEAT_LABEL, auction.seat)}席位竞标`
    : `${labelOf(SCOPE_LABEL, auction.selectionScope || 'primary')}竞标`;
  const fact = auction.winnerRoleId
    ? `中选 ${roleName(auction.winnerRoleId)}`
    : auction.status === 'running'
      ? '竞标进行中'
      : '后端没给赢家';
  return (
    <Fold
      id={`council-auction-${auction.auctionId || String(index)}`}
      title={title}
      status={auction.status === 'running' ? 'running' : 'idle'}
      fact={fact}
      meta={`${auction.candidates.length}/${auction.bids.length}`}
      defaultOpen={defaultOpen}
    >
      <div className="flex flex-wrap items-center gap-2">
        {auction.selectionScope && (
          <span className="text-body text-fg-muted">
            范围 {labelOf(SCOPE_LABEL, auction.selectionScope)}{' '}
            <span className="font-mono text-code text-fg-faint">{auction.selectionScope}</span>
          </span>
        )}
        {auction.selectionMode && (
          <span className="text-body text-fg-muted">
            方式 {labelOf(AUCTION_MODE_LABEL, auction.selectionMode)}{' '}
            <span className="font-mono text-code text-fg-faint">{auction.selectionMode}</span>
          </span>
        )}
        {auction.seatIndex !== null && (
          <span className="text-body text-fg-muted">
            席位序号 <span className="tabular font-mono text-code">{auction.seatIndex}</span>
          </span>
        )}
      </div>

      {auction.requirementProfile && (
        <div className="mt-2">
          <div className="text-body text-fg-muted">需求画像</div>
          <TagRow tags={auction.requirementProfile.personaKeywords} />
          <TagRow tags={auction.requirementProfile.preferredSkillTags} />
          <TagRow tags={auction.requirementProfile.preferredExperienceTags} />
        </div>
      )}

      <div className="mt-2">
        <div className="text-body text-fg-muted">
          候选人 · <span className="tabular">{auction.candidates.length}</span>
        </div>
        {auction.candidates.length === 0 ? (
          <p className="text-body text-fg-faint">这一场没有候选人明细（只收到了结果那半边）。</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {auction.candidates.map((candidate) => (
              <CandidateItem key={candidate.roleId} candidate={candidate} />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2">
        <div className="text-body text-fg-muted">
          报价 · <span className="tabular">{auction.bids.length}</span>
        </div>
        {auction.bids.length === 0 ? (
          <p className="text-body text-fg-faint">
            {auction.status === 'running' ? '还在收报价。' : '后端没有给出报价明细。'}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {auction.bids.map((bid, i) => (
              <BidItem
                key={bid.bidId || bid.roleId}
                bid={bid}
                rank={i + 1}
                sampled={auction.probabilitySampled}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 抽签参数只有真跑了 seeded-softmax 才有意义 */}
      {(auction.policyVersion || auction.seed || auction.probabilitySampled) && (
        <dl className="mt-2 space-y-1 border-t border-edge pt-2">
          {auction.policyVersion && <FactRow k="打分策略" v={auction.policyVersion} />}
          {auction.seed && <FactRow k="随机种子" v={auction.seed} />}
          {auction.probabilitySampled && auction.tau !== null && (
            <FactRow k="抽样温度" v={score2(auction.tau)} />
          )}
          {auction.probabilitySampled && auction.winnerProbability !== null && (
            <FactRow k="中选概率" v={pctOf(auction.winnerProbability)} />
          )}
        </dl>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-edge pt-2">
        {auction.winnerBidId && <IdChip value={auction.winnerBidId} label="中选报价" />}
        {auction.ledgerRef && <IdChip value={auction.ledgerRef} label="账本" />}
        {auction.auditRef && <IdChip value={auction.auditRef} label="审计" />}
      </div>

      {auction.taskDescription && (
        <p className="mt-2 border-t border-edge pt-2 text-body text-fg-muted">
          竞标议题：{auction.taskDescription}
        </p>
      )}
    </Fold>
  );
}

function CandidateItem({ candidate }: { candidate: CouncilAuctionCandidate }) {
  const m = candidate.metrics;
  return (
    <li className="rounded-panel border border-edge bg-surface-panel p-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-body text-fg-primary">{roleName(candidate.roleId)}</span>
        <span className="font-mono text-code text-fg-faint">{candidate.roleId}</span>
        {candidate.personaRef && <IdChip value={candidate.personaRef} label="画像" />}
      </div>
      {m && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-body text-fg-muted">
          <span>
            任务 <span className="tabular">{intOf(m.totalTasks)}</span>
          </span>
          <span>
            完成 <span className="tabular">{intOf(m.tasksCompleted)}</span>
          </span>
          <span>
            成功 <span className="tabular">{intOf(m.tasksSucceeded)}</span>
          </span>
          <span>
            技能 <span className="tabular">{intOf(m.skillCount)}</span>
          </span>
          <span>
            经验 <span className="tabular">{intOf(m.experienceCount)}</span>
          </span>
          <span>
            平均置信 <span className="tabular">{pctOf(m.avgConfidence)}</span>
          </span>
        </div>
      )}
      {candidate.load && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-body text-fg-muted">
          <span>
            在跑 <span className="tabular">{intOf(candidate.load.activeTaskCount)}</span>
          </span>
          <span>
            距上次 <span className="tabular">{intOf(candidate.load.daysSinceLastTask)}</span> 天
          </span>
        </div>
      )}
      <TagRow tags={candidate.personaKeywords} />
      <TagRow tags={candidate.skills.map((skill) => skill.name)} />
      {candidate.experiences.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {candidate.experiences.map((experience) => (
            <li
              key={experience.name}
              className="flex items-baseline gap-2 text-body text-fg-secondary"
            >
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  experience.type === 'positive' ? 'bg-ok' : 'bg-danger',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{experience.name}</span>
              <span className="tabular shrink-0 font-mono text-code text-fg-faint">
                {pctOf(experience.confidence)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function BidItem({
  bid,
  rank,
  sampled,
}: {
  bid: CouncilAuctionBid;
  rank: number;
  sampled: boolean;
}) {
  return (
    <li
      className={cn(
        'rounded-panel border bg-surface-panel p-2',
        bid.winner ? 'border-ok/60' : 'border-edge',
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="tabular shrink-0 text-meta text-fg-faint">{rank}</span>
        <span className="min-w-0 flex-1 truncate text-body text-fg-primary">
          {roleName(bid.roleId)}
        </span>
        {bid.winner && <Badge variant="ok">中选</Badge>}
        <span className="tabular shrink-0 font-mono text-code text-fg-primary">
          {score2(bid.finalScore)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-body text-fg-muted">
        {/* 抽中概率只在真跑了 seeded-softmax 时存在；固定指派 / 按名册顺序时没有抽签，
            把一个概率摆出来就是编造。 */}
        {sampled && (
          <span>
            抽中概率 <span className="tabular">{pctOf(bid.probability)}</span>
          </span>
        )}
        {bid.estimatedTimeSeconds !== null && (
          <span>
            预估 <span className="tabular">{bid.estimatedTimeSeconds}</span> 秒
          </span>
        )}
      </div>
      {bid.score && <ScoreBreakdown score={bid.score} />}
      {bid.strategySummary && (
        <p className="mt-1 text-body text-fg-secondary">{bid.strategySummary}</p>
      )}
    </li>
  );
}

/** 打分明细。后端分组是 relevance / quality 两大块 + 三个独立项，这里按同样的分组摊开。 */
function ScoreBreakdown({ score }: { score: CouncilBidScore }) {
  return (
    <div className="mt-1 space-y-0.5 border-t border-edge pt-1">
      <div className="flex flex-wrap gap-x-3 text-body text-fg-muted">
        <span className="text-fg-secondary">
          相关 <span className="tabular">{score2(score.relevance)}</span>
        </span>
        <span>
          画像 <span className="tabular">{score2(score.personaMatch)}</span>
        </span>
        <span>
          技能 <span className="tabular">{score2(score.skillMatch)}</span>
        </span>
        <span>
          经验 <span className="tabular">{score2(score.experienceMatch)}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 text-body text-fg-muted">
        <span className="text-fg-secondary">
          质量 <span className="tabular">{score2(score.quality)}</span>
        </span>
        <span>
          成功率 <span className="tabular">{score2(score.successRate)}</span>
        </span>
        <span>
          置信 <span className="tabular">{score2(score.avgConfidence)}</span>
        </span>
        <span>
          经验密度 <span className="tabular">{score2(score.experienceDensity)}</span>
        </span>
        <span>
          技能密度 <span className="tabular">{score2(score.skillDensity)}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 text-body text-fg-muted">
        <span>
          容量 <span className="tabular">{score2(score.capacity)}</span>
        </span>
        <span>
          新鲜度 <span className="tabular">{score2(score.freshness)}</span>
        </span>
        <span>
          加成 <span className="tabular">{score2(score.bonus)}</span>
        </span>
      </div>
    </div>
  );
}

/** 主执行席位的选人结果指纹 —— 只有结果，没有过程。 */
function PrimarySelectionBlock({ primary }: { primary: CouncilPrimarySelection }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Award className="h-3 w-3 text-ok" />
        <span className="text-body text-fg-primary">{roleName(primary.winnerAgentId)}</span>
        <span className="font-mono text-code text-fg-faint">{primary.winnerAgentId}</span>
      </div>
      <dl className="mt-1 space-y-1">
        {primary.selectionMode && (
          <FactRow k="选人方式" v={labelOf(AUCTION_MODE_LABEL, primary.selectionMode)} />
        )}
        {primary.policyVersion && <FactRow k="打分策略" v={primary.policyVersion} />}
        {primary.seed && <FactRow k="随机种子" v={primary.seed} />}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {primary.winnerBidId && <IdChip value={primary.winnerBidId} label="中选报价" />}
        {primary.ledgerRef && <IdChip value={primary.ledgerRef} label="账本" />}
        {primary.auditRef && <IdChip value={primary.auditRef} label="审计" />}
      </div>
      <p className="mt-2 text-body text-fg-muted">
        这条只记录选人结果，竞标过程后端没有留下 —— 没有报价明细可看。
      </p>
    </div>
  );
}

// ── 左栏：席位名册 / 议题 / 事件序 ──

function RosterFold({
  participants,
  selectionMode,
}: {
  participants: CouncilParticipantCard[];
  selectionMode: string;
}) {
  return (
    <Fold
      id="council-roster"
      title="席位名册"
      fact={participants.length > 0 ? `${participants.length} 席` : '还没定'}
      defaultOpen
    >
      {selectionMode && (
        <p className="text-body text-fg-muted">
          名册来源 {labelOf(ROSTER_MODE_LABEL, selectionMode)}{' '}
          <span className="font-mono text-code text-fg-faint">{selectionMode}</span>
        </p>
      )}
      {participants.length === 0 ? (
        <p className="text-body text-fg-muted">席位还没定下来。</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {participants.map((participant) => (
            <li
              key={participant.participantId}
              className="rounded-panel border border-edge bg-surface-panel p-2"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-body text-fg-primary">
                  {labelOf(SEAT_LABEL, participant.seat)}
                </span>
                <span className="font-mono text-code text-fg-faint">{participant.seat}</span>
                {participant.seatIndex !== null && (
                  <span className="tabular text-meta text-fg-faint">#{participant.seatIndex}</span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="text-body text-fg-secondary">{roleName(participant.agentId)}</span>
                <span className="font-mono text-code text-fg-faint">{participant.agentId}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <IdChip value={participant.participantId} label="席位 ID" />
                {participant.roleProfileRef && (
                  <IdChip value={participant.roleProfileRef} label="画像" />
                )}
              </div>
              {participant.selectionRefs.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {participant.selectionRefs.map((refId) => (
                    <IdChip key={refId} value={refId} label="选人凭证" />
                  ))}
                </div>
              )}
              {participant.conflictFlags.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-body text-human-soft">占位冲突</span>
                  {participant.conflictFlags.map((flag) => (
                    <span key={flag} className="font-mono text-code text-fg-faint">
                      {flag}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

function SubjectFold({ model }: { model: CouncilBoardModel }) {
  const firstLine = model.subject.split('\n')[0] || '后端没给议题正文';
  return (
    <Fold id="council-subject" title="议题" fact={firstLine} defaultOpen>
      {model.subject ? (
        <div className="max-h-32 overflow-y-auto whitespace-pre-line rounded-panel border border-edge bg-surface-panel p-2 text-body text-fg-secondary">
          {model.subject}
        </div>
      ) : (
        <p className="text-body text-fg-muted">这一轮没有回显议题正文。</p>
      )}
      <dl className="mt-2 space-y-1">
        {model.strategy && (
          <FactRow k="合议策略" v={labelOf(STRATEGY_LABEL, model.strategy)} raw={model.strategy} />
        )}
        {model.artifactMode && (
          <FactRow
            k="产出形态"
            v={labelOf(ARTIFACT_MODE_LABEL, model.artifactMode)}
            raw={model.artifactMode}
          />
        )}
        {model.trigger && (
          <FactRow k="触发方式" v={labelOf(TRIGGER_LABEL, model.trigger)} raw={model.trigger} />
        )}
      </dl>
      {model.councilRunId && (
        <div className="mt-2">
          <IdChip value={model.councilRunId} label="合议 ID" />
        </div>
      )}
    </Fold>
  );
}

function FeedFold({ feed }: { feed: { time: string; type: string; roleId: string }[] }) {
  return (
    <Fold id="council-feed-list" title="事件序" fact={`${feed.length} 条`} defaultOpen>
      {feed.length === 0 ? (
        <p className="text-body text-fg-muted">还没有合议事件。</p>
      ) : (
        <ul className="space-y-1">
          {feed.map((item, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="tabular shrink-0 text-meta text-fg-faint">{item.time}</span>
              <span className="min-w-0 flex-1 text-body text-fg-secondary">
                {labelOf(EVENT_LABEL, item.type)}
                {item.roleId && <span className="text-fg-muted"> · {roleName(item.roleId)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Fold>
  );
}

// ── 中栏：席位告警 + 提案 ──

/**
 * `council.role.failed` —— **单个席位**执行失败。
 *
 * 后端吞掉这个错误、带着缺席的席位继续跑，所以它绝不能读起来像「合议失败」：
 * 用 human 色（提醒）而不是 danger（终止），并且明说合议还在继续。
 * 真正的终止走 `council.failed`，那一条渲染在页面抬头下方的红色横幅里。
 */
function RoleFailureList({ failures }: { failures: CouncilRoleFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {failures.map((failure, i) => (
        <div
          key={`${failure.participantId}-${String(i)}`}
          className="rounded-panel border border-human/30 bg-human/5 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-human-soft" />
            <span className="text-body text-human-soft">
              {labelOf(ROLE_FAILURE_LABEL, failure.code)}
            </span>
            <span className="font-mono text-code text-fg-faint">{failure.code}</span>
            {failure.seat && (
              <span className="text-body text-fg-secondary">
                {labelOf(SEAT_LABEL, failure.seat)} · {roleName(failure.agentId)}
              </span>
            )}
            <span className="tabular text-meta text-fg-faint">{failure.time}</span>
          </div>
          <p className="mt-1 text-body text-fg-secondary">
            {failure.errorMessage || '后端没有给出失败原因。'}
          </p>
          <p className="mt-1 text-body text-fg-muted">
            合议没有因此中止 —— 后端带着这个缺席的席位继续跑完了这一轮。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {failure.driverErrorCode && (
              <span className="font-mono text-code text-fg-faint">{failure.driverErrorCode}</span>
            )}
            {failure.agentStatus && (
              <span className="text-body text-fg-muted">
                执行状态 <span className="font-mono text-code">{failure.agentStatus}</span>
              </span>
            )}
            {failure.participantId && <IdChip value={failure.participantId} label="席位 ID" />}
            {failure.agentRunId && <IdChip value={failure.agentRunId} label="执行 ID" />}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  onOpenArtifact,
}: {
  proposal: CouncilProposalCard;
  onOpenArtifact: (artifactId: string) => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-panel border bg-surface-panel p-4',
        proposal.selected ? 'border-ok/60 ring-1 ring-ok/40' : 'border-edge',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-title text-fg-primary">{roleName(proposal.roleId)}</span>
        {proposal.selected && <Badge variant="ok">已选中</Badge>}
      </div>
      {proposal.seat && (
        <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
          <span className="text-body text-fg-muted">{labelOf(SEAT_LABEL, proposal.seat)}</span>
          <span className="font-mono text-code text-fg-faint">{proposal.seat}</span>
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <IdChip value={proposal.proposalId} label="提案 ID" />
        {proposal.participantId && <IdChip value={proposal.participantId} label="席位 ID" />}
      </div>

      {proposal.summary ? (
        <p className="mt-2 text-body text-fg-secondary">{proposal.summary}</p>
      ) : (
        <p className="mt-2 text-body text-fg-muted">提案正文随终态快照到达。</p>
      )}

      {proposal.reviews.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-body text-fg-muted">评审</div>
          {proposal.reviews.map((review) => {
            const badge = badgeOf(REVIEW_BADGE, review.verdict);
            return (
              <div key={review.reviewId} className="rounded-panel border border-edge p-2">
                <div className="flex flex-wrap items-center gap-2">
                  {badge ? (
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  ) : (
                    <Badge>评审中</Badge>
                  )}
                  {review.verdict && (
                    <span className="font-mono text-code text-fg-faint">{review.verdict}</span>
                  )}
                  {review.reviewerId && (
                    <span className="text-body text-fg-muted">{roleName(review.reviewerId)}</span>
                  )}
                </div>
                {review.reason && (
                  <p className="mt-1 text-body text-fg-secondary">{review.reason}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {proposal.assumptions.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-body text-fg-muted">前置假设</div>
          <ul className="space-y-0.5 text-body text-fg-secondary">
            {proposal.assumptions.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal.knownRisks.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-body text-danger">
            <AlertTriangle className="h-3 w-3" /> 已知风险
          </div>
          <ul className="space-y-0.5 text-body text-fg-secondary">
            {proposal.knownRisks.map((risk) => (
              <li key={risk}>· {risk}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal.completionEvidence.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-body text-fg-muted">完成证据</div>
          <ul className="space-y-0.5 text-body text-fg-secondary">
            {proposal.completionEvidence.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>
      )}

      {proposal.affectedPaths.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-body text-fg-muted">
            <FileCode2 className="h-3 w-3" /> 影响文件
          </div>
          <div className="flex flex-wrap gap-1">
            {proposal.affectedPaths.map((path) => (
              <span
                key={path}
                className="rounded-chip bg-surface-raised px-1.5 font-mono text-code text-fg-secondary"
              >
                {path}
              </span>
            ))}
          </div>
        </div>
      )}

      <ArtifactRefs refs={proposal.artifactRefs} label="产物" onOpen={onOpenArtifact} />
    </div>
  );
}

// ── 右栏：实施 / 结果 / 交付 ──

function ImplementationBlock({
  implementation,
  onOpenArtifact,
}: {
  implementation: CouncilImplementationCard;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const executor = implementation.executorRoleId || implementation.agentId;
  return (
    <div className="rounded-panel border border-edge bg-surface-panel p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-body text-fg-primary">{roleName(executor)}</span>
        {executor && <span className="font-mono text-code text-fg-faint">{executor}</span>}
      </div>
      {implementation.response ? (
        <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-line rounded-panel border border-edge bg-surface-raised p-2 text-body text-fg-secondary">
          {implementation.response}
        </div>
      ) : (
        <p className="mt-1 text-body text-fg-muted">
          实施回复没有随快照到达 —— 终态快照的 plan_execution 不带正文。
        </p>
      )}
      <ArtifactRefs
        refs={implementation.finalPlanArtifactRefs}
        label="最终方案"
        onOpen={onOpenArtifact}
      />
      <ArtifactRefs
        refs={implementation.implementationArtifactRefs}
        label="实施产物"
        onOpen={onOpenArtifact}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {implementation.sessionId && <IdChip value={implementation.sessionId} label="会话" />}
        {implementation.agentRunId && <IdChip value={implementation.agentRunId} label="执行 ID" />}
        {implementation.driverRunResultId && (
          <IdChip value={implementation.driverRunResultId} label="驱动结果" />
        )}
      </div>
    </div>
  );
}

function OutcomeBlock({ outcome }: { outcome: CouncilOutcome }) {
  const badge = badgeOf(OUTCOME_BADGE, outcome.status) ?? {
    label: outcome.status,
    variant: 'default' as const,
  };
  return (
    <div>
      <SectionLabel icon={BadgeCheck}>结果</SectionLabel>
      <div className="rounded-panel border border-edge bg-surface-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span className="font-mono text-code text-fg-faint">{outcome.status}</span>
          <span className="text-body text-fg-muted">
            质量 {labelOf(QUALITY_LABEL, outcome.quality)}{' '}
            <span className="font-mono text-code text-fg-faint">{outcome.quality}</span>
          </span>
        </div>
        {outcome.decision_summary ? (
          <p className="mt-2 text-body text-fg-secondary">{outcome.decision_summary}</p>
        ) : (
          <p className="mt-2 text-body text-fg-muted">后端没有给结论摘要。</p>
        )}
        {outcome.participant_role_ids.length > 0 && (
          <p className="mt-1 text-body text-fg-muted">
            参与席位：
            {outcome.participant_role_ids.map((id) => roleName(id)).join(' · ')}
          </p>
        )}
        <BulletList
          label="未解决问题"
          items={outcome.unresolved_issues}
          tone="human"
          empty="没有遗留问题。"
        />
        <BulletList label="告警" items={outcome.warnings} tone="human" />
        {outcome.audit_refs.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {outcome.audit_refs.map((refId) => (
              <IdChip key={refId} value={refId} label="审计" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 交付信封 —— `council.output`。
 *
 * 这里的价值全在 `generatedArtifacts`：同一个文件通常有**好几份**，每位提案者在
 * 自己的席位工作区各写了一份，综合席位再写一份。按 targetPath 分组呈现，让「几位
 * agent 各自改了同一个文件」这件事看得见；点开任意一份就是当时那份正文。
 */
function OutputBlock({
  output,
  onOpenArtifact,
}: {
  output: CouncilOutputCard;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const groups = new Map<string, typeof output.generatedArtifacts>();
  for (const artifact of output.generatedArtifacts) {
    const key = artifact.targetPath || artifact.artifactId;
    const bucket = groups.get(key);
    if (bucket) bucket.push(artifact);
    else groups.set(key, [artifact]);
  }
  return (
    <div>
      <SectionLabel icon={PackageCheck}>交付信封</SectionLabel>
      <div className="rounded-panel border border-edge bg-surface-panel p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body text-fg-secondary">
            {labelOf(OUTPUT_STATUS_LABEL, output.status)}{' '}
            <span className="font-mono text-code text-fg-faint">{output.status}</span>
          </span>
          {output.canCreateMergeAuthorization && <Badge variant="ok">可发起合并授权</Badge>}
        </div>
        {groups.size === 0 ? (
          <p className="mt-1 text-body text-fg-muted">后端没有列出本次产出的文件。</p>
        ) : (
          <div className="mt-2 space-y-2">
            {[...groups].map(([targetPath, items]) => (
              <div key={targetPath}>
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-code text-fg-primary">
                    {targetPath}
                  </span>
                  {items.length > 1 && (
                    <span className="tabular shrink-0 text-meta text-fg-faint">
                      {items.length} 份
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-1">
                  {items.map((artifact) => (
                    <li key={artifact.artifactId} className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onOpenArtifact(artifact.artifactId);
                        }}
                        className="truncate rounded-chip border border-edge bg-surface-raised px-2 font-mono text-code text-fg-secondary hover:border-command hover:text-fg-primary"
                      >
                        {artifact.artifactId}
                      </button>
                      {artifact.source && (
                        <span className="text-body text-fg-muted">
                          席位 <span className="font-mono text-code">{artifact.source}</span>
                        </span>
                      )}
                      {artifact.type && (
                        <span className="font-mono text-code text-fg-faint">{artifact.type}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-edge pt-2">
          {output.outputId && <IdChip value={output.outputId} label="交付 ID" />}
          {output.decisionRef && <IdChip value={output.decisionRef} label="裁决引用" />}
        </div>
      </div>
    </div>
  );
}

function ResultBlock({
  result,
  hasOutcome,
  onOpenArtifact,
}: {
  result: CouncilResultCard;
  hasOutcome: boolean;
  onOpenArtifact: (artifactId: string) => void;
}) {
  return (
    <div>
      <SectionLabel icon={ShieldCheck}>交付与验证</SectionLabel>
      <div className="rounded-panel border border-edge bg-surface-panel p-3">
        {/* quality / warnings 与 outcome 同源，两块都印一遍只是噪音 —— outcome 在就不重复 */}
        {!hasOutcome && result.quality && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body text-fg-muted">
              质量 {labelOf(QUALITY_LABEL, result.quality)}{' '}
              <span className="font-mono text-code text-fg-faint">{result.quality}</span>
            </span>
          </div>
        )}
        <ArtifactRefs
          refs={result.finalArtifactRef ? [result.finalArtifactRef] : []}
          label="最终产物"
          onOpen={onOpenArtifact}
        />
        {result.finalArtifactSha256 && (
          <dl className="mt-1">
            <FactRow k="摘要" v={result.finalArtifactSha256} />
          </dl>
        )}
        <BulletList label="未满足的验收标准" items={result.unmetCriteria} tone="human" />
        {!hasOutcome && <BulletList label="告警" items={result.warnings} tone="human" />}
        {(result.verificationRefs.length > 0 || result.decisionRecordRef) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {result.verificationRefs.map((refId) => (
              <IdChip key={refId} value={refId} label="验证" />
            ))}
            {result.decisionRecordRef && (
              <IdChip value={result.decisionRecordRef} label="决策记录" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 通用小件 ──

/**
 * 产物引用 —— 点开就是完整正文（artifact.getContent）。
 *
 * 在此之前这里是一排死 ID：能看见、能复制，就是打不开。
 */
function ArtifactRefs({
  refs,
  label,
  onOpen,
}: {
  refs: string[];
  label: string;
  onOpen: (artifactId: string) => void;
}) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1 text-body text-fg-muted">
        <Link2 className="h-3 w-3" /> {label} · <span className="tabular">{refs.length}</span>
      </div>
      <div className="space-y-1">
        {refs.map((artifactId) => (
          <button
            key={artifactId}
            type="button"
            title={`查看正文 ${artifactId}`}
            onClick={() => {
              onOpen(artifactId);
            }}
            className="flex w-full items-center gap-1 rounded-chip border border-edge bg-surface-raised px-2 text-left transition-colors hover:border-edge-strong hover:text-fg-primary"
          >
            <FileText className="h-3 w-3 shrink-0 text-fg-faint" />
            <span className="min-w-0 flex-1 truncate font-mono text-code text-fg-secondary">
              {artifactId}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BulletList({
  label,
  items,
  tone,
  empty,
}: {
  label: string;
  items: string[];
  tone?: 'human';
  empty?: string;
}) {
  if (items.length === 0) {
    if (!empty) return null;
    return (
      <p className="mt-2 text-body text-fg-muted">
        {label}：{empty}
      </p>
    );
  }
  return (
    <div className="mt-2">
      <div className={cn('mb-1 text-body', tone === 'human' ? 'text-human-soft' : 'text-fg-muted')}>
        {label} · <span className="tabular">{items.length}</span>
      </div>
      <ul className="space-y-0.5 text-body text-fg-secondary">
        {items.map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}

/** 一条事实：左灰键、右等宽值，值超长就截断（完整值在 title 里）。 */
function FactRow({ k, v, raw }: { k: string; v: string; raw?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-body">
      <span className="shrink-0 text-fg-muted">{k}</span>
      <span className="min-w-0 truncate text-right text-fg-secondary" title={raw ?? v}>
        {v}
        {raw && <span className="ml-1.5 font-mono text-code text-fg-faint">{raw}</span>}
      </span>
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-chip bg-surface-raised px-1.5 font-mono text-code text-fg-secondary"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Scale; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1 text-body text-fg-muted">
      <Icon className="h-3 w-3" /> {children}
    </div>
  );
}

function PanelTitle({ icon: Icon, children }: { icon: typeof Scale; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-edge px-4 py-2 text-title text-fg-secondary">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

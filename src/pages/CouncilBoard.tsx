import {
  Scale,
  ArrowLeft,
  AlertTriangle,
  FileCode2,
  Gavel,
  Link2,
  MessagesSquare,
  Sparkles,
} from 'lucide-react';
import { selectActiveLiveRun, useDemoStore } from '@/store/useDemoStore';
import { SidePanel } from '@/components/SidePanel';
import { Button } from '@/components/ui/Button';
import { Badge, type BadgeProps } from '@/components/ui/Badge';
import { IdChip } from '@/components/ui/IdChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { isFrontendWorkflowV01 } from '@/api/types/rpc';
import type { CouncilDecision, Review } from '@/api/types/council';
import { buildCouncilBoard, type CouncilProposalCard } from '@/lib/councilBoard';
import { roleName } from '@/lib/roleNames';
import { cn } from '@/lib/utils';

/**
 * 合议 —— proposer / reviewer / synthesizer 裁决过程的**观察面板**。
 *
 * 数据完全来自真实 run：运行中由 council.* 事件逐步长出（谁提了案、谁在评审），
 * 终态用快照的 `snapshot.council` 补全正文（提案 summary / 评审意见 / 综合结论）。
 *
 * 【R4】这里**没有任何裁决按钮**：合议由后端 agent 自主完成，Polaris 没有把人工
 * 裁决送回后端的通道 —— 一个只改本地状态的「采纳」按钮会让用户以为自己影响了结果。
 * 旧版的「你的裁决」面板正是这样一个谎言，已删除。
 */
export function CouncilBoard() {
  const setPage = useDemoStore((s) => s.setPage);
  const live = useDemoStore(selectActiveLiveRun);

  const snapshot = live?.snapshot;
  const council =
    snapshot && isFrontendWorkflowV01(snapshot) ? (snapshot.council ?? undefined) : undefined;
  const model = live ? buildCouncilBoard(live.timeline, council) : null;

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 抬头：状态 + 决议标识（机器 ID 收进 IdChip） */}
      <header className="border-b border-edge px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-command" />
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
          两位提案者各给出一份候选实现，评审员逐案评审，综合员产出最终候选 ——
          裁决由后端自主完成，这里呈现全过程。
        </p>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左：过程（合议事件序，全部真实事件） */}
        <SidePanel
          side="left"
          title="过程"
          defaultWidth={260}
          minWidth={200}
          maxWidth={400}
          storageKey="council-feed"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={MessagesSquare}>过程</PanelTitle>
            <ul className="flex-1 space-y-1 overflow-y-auto p-3">
              {model.feed.map((item, i) => (
                <li key={i} className="flex items-baseline gap-2 px-1 py-0.5">
                  <span className="tabular shrink-0 text-meta text-fg-faint">{item.time}</span>
                  <span className="min-w-0 flex-1 text-body text-fg-secondary">
                    {EVENT_LABEL[item.type] ?? item.type}
                    {item.roleId && (
                      <span className="text-fg-muted"> · {roleName(item.roleId)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </SidePanel>

        {/* 中：提案（运行中是骨架，终态补全正文） */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelTitle icon={Scale}>提案 · {model.proposals.length}</PanelTitle>
          <div className="grid flex-1 grid-cols-1 content-start gap-4 overflow-y-auto p-4 xl:grid-cols-2">
            {model.proposals.length === 0 && (
              <p className="text-body text-fg-muted">提案者还在起草 —— 提案完成后会出现在这里。</p>
            )}
            {model.proposals.map((proposal) => (
              <ProposalCard key={proposal.proposalId} proposal={proposal} />
            ))}
          </div>
        </div>

        {/* 右：综合与裁决（只读） */}
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
                <div className="mb-1.5 flex items-center gap-1 text-body text-fg-muted">
                  <Sparkles className="h-3 w-3" /> 综合
                </div>
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
                  </div>
                ) : (
                  <p className="text-body text-fg-muted">
                    {model.status === 'running' ? '综合还未开始。' : '本次合议没有综合产出。'}
                  </p>
                )}
              </div>

              {/* 裁决 */}
              <div>
                <div className="mb-1.5 flex items-center gap-1 text-body text-fg-muted">
                  <Gavel className="h-3 w-3" /> 裁决
                </div>
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
                    {model.decision.terminationReason && (
                      <p className="mt-1 text-body text-fg-muted">
                        终止原因：{model.decision.terminationReason}
                      </p>
                    )}
                    {model.decision.selectedArtifactRefs.length > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center gap-1 text-body text-fg-muted">
                          <Link2 className="h-3 w-3" /> 选中产物 ·{' '}
                          <span className="tabular">
                            {model.decision.selectedArtifactRefs.length}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {model.decision.selectedArtifactRefs.map((ref) => (
                            <div
                              key={ref}
                              className="truncate rounded-chip border border-edge bg-surface-raised px-2 font-mono text-code text-fg-secondary"
                            >
                              {ref}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-body text-fg-muted">
                    {model.status === 'running' ? '裁决还未产生。' : '本次合议没有产生裁决。'}
                  </p>
                )}
              </div>

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

            <div className="space-y-2 border-t border-edge p-4">
              <p className="text-body text-fg-muted">
                合议由后端 agent 自主完成，Polaris 没有把人工裁决送回后端的通道 ——
                所以这里不给按钮。
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
    </div>
  );
}

// ── 词表（主层说人话，协议原文只作灰色注解）──

const STATUS_BADGE: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  running: { label: '合议进行中', variant: 'command' },
  completed: { label: '合议完成', variant: 'ok' },
  failed: { label: '合议失败', variant: 'danger' },
};

type VerdictBadge = { label: string; variant: BadgeProps['variant'] };

const DEFAULT_VERDICT: VerdictBadge = { label: '裁决', variant: 'default' };

/**
 * 裁决词表。**键类型锚在契约的 verdict 联合上** —— 后端加一个取值，这里就编译不过，
 * 而不是在界面上静默显示成一个没人认识的英文原文。
 * （曾经这个哨兵是 api/map.ts 的 `UI_TO_CONTRACT_COUNCIL_VERDICT`，但它锚在一个写错的
 * 契约类型上，后端从没发过那三个值，所以它从来没响过。）
 */
const VERDICT_BADGE: Record<CouncilDecision['verdict'], VerdictBadge> = {
  select: { label: '采纳方案', variant: 'ok' },
  needs_human: { label: '需要人工', variant: 'human' },
  request_revision: { label: '要求修改', variant: 'human' },
  reject: { label: '拒绝', variant: 'danger' },
};

const REVIEW_BADGE: Record<Review['verdict'], VerdictBadge> = {
  approve: { label: '通过', variant: 'ok' },
  needs_revision: { label: '需修改', variant: 'human' },
  reject: { label: '拒绝', variant: 'danger' },
};

/** 后端原文可能是词表外的新取值 —— 运行时兜底，不让界面崩在一个陌生字符串上。 */
const badgeOf = (table: Record<string, VerdictBadge>, verdict: string): VerdictBadge | undefined =>
  table[verdict];

const EVENT_LABEL: Record<string, string> = {
  'council.started': '合议开始',
  'council.proposal.completed': '提案完成',
  'council.review.completed': '评审完成',
  'council.synthesis.completed': '综合完成',
  'council.decision': '裁决产生',
  'council.completed': '合议结束',
  'council.failed': '合议失败',
};

function ProposalCard({ proposal }: { proposal: CouncilProposalCard }) {
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
      <div className="mt-1">
        <IdChip value={proposal.proposalId} label="提案 ID" />
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
                <div className="flex items-center gap-2">
                  {badge ? (
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  ) : (
                    <Badge>评审中</Badge>
                  )}
                  {review.verdict && (
                    <span className="font-mono text-code text-fg-faint">{review.verdict}</span>
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

      {proposal.artifactRefs.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-body text-fg-muted">
            <Link2 className="h-3 w-3" /> 产物 ·{' '}
            <span className="tabular">{proposal.artifactRefs.length}</span>
          </div>
          <div className="space-y-1">
            {proposal.artifactRefs.map((ref) => (
              <div
                key={ref}
                className="truncate rounded-chip border border-edge bg-surface-raised px-2 font-mono text-code text-fg-secondary"
              >
                {ref}
              </div>
            ))}
          </div>
        </div>
      )}
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

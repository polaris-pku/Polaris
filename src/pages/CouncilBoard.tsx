import { useState } from 'react';
import {
  MessagesSquare,
  Scale,
  CheckCircle2,
  ArrowLeft,
  Star,
  ThumbsUp,
  AlertTriangle,
  FileCode2,
  Gavel,
  Link2,
  ShieldAlert,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { SidePanel } from '@/components/SidePanel';
import { verdictDefs } from '@/data/councilOptions';
import { findOption } from '@/data/scenario';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { IdChip } from '@/components/ui/IdChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';
import type { CouncilVerdict } from '@/types';

/**
 * 合议（原「议会」页）。
 *
 * 「Council / 议会」在同一句话里出现过两种语言 —— 统一为「合议」。
 * 紫色（council 色相）已删除：合议本质上就是「轮到人裁决」→ 并入 human；
 * 而「选中 / 推荐」是机器态 → command。发言人的 4 色左缘也删了：
 * 责任方不再靠颜色编码，只留一条不着色的左缘线（§4.3）。
 */
export function CouncilBoard() {
  const confirmCouncilOption = useDemoStore((s) => s.confirmCouncilOption);
  const confirmedId = useDemoStore((s) => s.confirmedCouncilOptionId);
  const setPage = useDemoStore((s) => s.setPage);
  const replay = useDemoStore(selectActiveReplay);

  // Council 数据只来自真实 run 的快照（后端给什么展示什么），不用 mock 议程顶替
  const scenario = replay?.scenario;
  const council = scenario?.council;
  const councilOptions = council?.options ?? [];

  const [selectedId, setSelectedId] = useState(
    councilOptions.find((o) => o.recommended)?.id ?? councilOptions[0]?.id ?? '',
  );
  const [verdict, setVerdict] = useState<CouncilVerdict>('select');

  // 本次 run 没有合议数据（未触发合议 / Gate 直通 / 还没跑）→ 只呈现该事实
  if (!scenario || !council || councilOptions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Scale}
          title={council?.context.title ?? '本次任务未触发合议裁决'}
          hint={council?.context.description ?? '单 Agent 模式或 Gate 直通的 run 不产生合议议程。'}
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

  const {
    context: councilContext,
    discussion,
    evidenceRefs,
    riskSignals,
    recommendedReason,
  } = council;
  const selectedOption = findOption(scenario, selectedId)!;
  const verdictDef = verdictDefs.find((v) => v.id === verdict)!;
  // 只有「采纳方案」会驱动主链路继续（采纳 + 委托决策 → 合并授权）
  const canAdvance = verdict === 'select';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 抬头 */}
      <header className="border-b border-edge px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-human" />
          <h1 className="text-title text-fg-primary">合议</h1>
          <Badge variant="human">等待裁决</Badge>
          <IdChip value={councilContext.councilId} label="合议 ID" />
          <span className="text-body text-fg-muted">
            决策模式 <span className="font-mono text-code">{councilContext.decisionMode}</span>
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-body text-fg-secondary">{councilContext.description}</p>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左：Agent 讨论 */}
        <SidePanel
          side="left"
          title="Agent 讨论"
          defaultWidth={300}
          minWidth={220}
          maxWidth={460}
          storageKey="council-discussion"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={MessagesSquare}>Agent 讨论</PanelTitle>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {discussion.map((d, i) => (
                <div
                  key={i}
                  // 责任方不再着色：位置 + 一条不着色的左缘线就够了（6–9 色色板已删）
                  className="rounded-panel border border-edge border-l-2 border-l-edge-strong bg-surface-panel p-3"
                >
                  <div className="text-title text-fg-primary">{d.agent}</div>
                  <span className="text-body text-fg-muted">{d.role}</span>
                  <p className="mt-1.5 text-body text-fg-secondary">{d.message}</p>
                </div>
              ))}
            </div>
          </div>
        </SidePanel>

        {/* 中：方案对比 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PanelTitle icon={Scale}>方案对比</PanelTitle>
          <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
            {councilOptions.map((opt) => {
              const active = selectedId === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSelectedId(opt.id);
                  }}
                  className={cn(
                    'flex flex-col rounded-panel border bg-surface-panel p-4 text-left transition-colors',
                    active
                      ? 'border-command/60 ring-1 ring-command/40'
                      : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-title text-fg-primary">{opt.title}</span>
                    {opt.recommended && (
                      <Badge variant="command" className="shrink-0">
                        <Star className="h-3 w-3" /> 推荐
                      </Badge>
                    )}
                  </div>
                  <span className="mt-0.5 text-body text-fg-muted">提出者：{opt.proposedBy}</span>
                  <p className="mt-2 text-body text-fg-secondary">{opt.summary}</p>

                  <div className="mt-3 space-y-2">
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-body text-ok">
                        <ThumbsUp className="h-3 w-3" /> 优点
                      </div>
                      <ul className="space-y-0.5 text-body text-fg-secondary">
                        {opt.pros.map((p) => (
                          <li key={p}>· {p}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-body text-danger">
                        <AlertTriangle className="h-3 w-3" /> 风险
                      </div>
                      <ul className="space-y-0.5 text-body text-fg-secondary">
                        {opt.risks.map((r) => (
                          <li key={r}>· {r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-body text-fg-muted">
                      <FileCode2 className="h-3 w-3" /> 影响文件
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {opt.impactedFiles.map((f) => (
                        <span
                          key={f}
                          className="rounded-chip bg-surface-raised px-1.5 font-mono text-code text-fg-secondary"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 border-t border-edge pt-2">
                    <div className="mb-1 text-body text-fg-muted">Agent 评分</div>
                    <div className="space-y-1">
                      {Object.entries(opt.scores).map(([k, v]) => (
                        <ScoreBar key={k} label={k} value={v} />
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右：你的裁决 */}
        <SidePanel
          side="right"
          title="你的裁决"
          defaultWidth={340}
          minWidth={280}
          maxWidth={520}
          storageKey="council-decision"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={Gavel}>你的裁决</PanelTitle>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* 裁决类型 */}
              <div>
                <div className="mb-1.5 text-body text-fg-muted">裁决类型</div>
                <div className="space-y-1.5">
                  {verdictDefs.map((v) => {
                    const active = verdict === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => {
                          setVerdict(v.id);
                        }}
                        disabled={!!confirmedId}
                        className={cn(
                          'w-full rounded-panel border bg-surface-panel p-2 text-left transition-colors disabled:opacity-60',
                          active
                            ? 'border-command/60 ring-1 ring-command/40'
                            : 'border-edge hover:border-edge-strong',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'text-body',
                              active ? 'text-command-soft' : 'text-fg-primary',
                            )}
                          >
                            {v.label}
                          </span>
                          <span className="text-body text-fg-muted">{v.landing}</span>
                        </div>
                        <p className="mt-1 text-body text-fg-muted">{v.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 已选方案 —— 只有「采纳方案」时才有意义 */}
              {verdict === 'select' && (
                <div>
                  <div className="mb-1 text-body text-fg-muted">已选方案</div>
                  <div className="flex items-center gap-2 rounded-panel border border-command/30 bg-surface-panel p-2">
                    <span className="text-body text-fg-primary">{selectedOption.title}</span>
                    {selectedOption.recommended && (
                      <Badge variant="command" className="ml-auto">
                        <Star className="h-3 w-3" /> 推荐
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-body text-fg-muted">
                    {selectedOption.recommended
                      ? recommendedReason
                      : '该方案非系统推荐，确认前请评估其风险与维护成本。'}
                  </p>
                </div>
              )}

              {/* 证据 */}
              <div>
                <div className="mb-1.5 flex items-center gap-1 text-body text-fg-muted">
                  <Link2 className="h-3 w-3" /> 证据 ·{' '}
                  <span className="tabular">{evidenceRefs.length}</span>
                </div>
                <div className="space-y-1">
                  {evidenceRefs.map((ref) => (
                    <div
                      key={ref}
                      className="truncate rounded-chip border border-edge bg-surface-raised px-2 font-mono text-code text-fg-secondary"
                    >
                      {ref}
                    </div>
                  ))}
                </div>
              </div>

              {/* 风险信号 */}
              <div>
                <div className="mb-1.5 flex items-center gap-1 text-body text-danger">
                  <ShieldAlert className="h-3 w-3" /> 风险信号 ·{' '}
                  <span className="tabular">{riskSignals.length}</span>
                </div>
                <ul className="space-y-1">
                  {riskSignals.map((r) => (
                    <li key={r} className="flex gap-1.5 text-body text-fg-secondary">
                      <AlertTriangle className="mt-1 h-3 w-3 shrink-0 text-danger" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {confirmedId && (
                <div className="flex items-center gap-2 rounded-panel border border-ok/30 bg-surface-panel p-3 text-body text-ok-soft">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  已采纳「{findOption(scenario, confirmedId)?.title}」，任务流已继续。
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-edge p-4">
              <div className="flex items-center gap-2 text-body text-fg-muted">
                最终裁决权属于你 · 落点
                <Badge variant={verdictDef.variant}>{verdictDef.landing}</Badge>
              </div>
              {canAdvance ? (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!!confirmedId}
                  onClick={() => {
                    confirmCouncilOption(selectedId);
                  }}
                >
                  <Gavel className="h-4 w-4" />
                  采纳「{selectedOption.title}」
                </Button>
              ) : (
                <div className="rounded-panel border border-human/30 bg-surface-panel p-2 text-body text-human-soft">
                  该裁决会让任务{verdictDef.landing}
                  ，主链路在此暂停（只有「采纳方案」会继续到合并授权）。
                </div>
              )}
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

function PanelTitle({ icon: Icon, children }: { icon: typeof Scale; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-edge px-4 py-2 text-title text-fg-secondary">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-body text-fg-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
        <div className="h-full rounded-full bg-command" style={{ width: `${value * 10}%` }} />
      </div>
      <span className="tabular w-5 shrink-0 text-right text-body text-fg-secondary">{value}</span>
    </div>
  );
}

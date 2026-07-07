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
import { deriveScenario, findOption } from '@/data/scenario';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type { CouncilVerdict, DiscussionMessage } from '@/types';

const accentColor: Record<DiscussionMessage['accent'], string> = {
  backend: 'border-l-cyan-500/60 bg-cyan-500/5',
  test: 'border-l-emerald-500/60 bg-emerald-500/5',
  security: 'border-l-rose-500/60 bg-rose-500/5',
  system: 'border-l-slate-500/60 bg-slate-500/5',
};

export function CouncilBoard() {
  const confirmCouncilOption = useDemoStore((s) => s.confirmCouncilOption);
  const confirmedId = useDemoStore((s) => s.confirmedCouncilOptionId);
  const setPage = useDemoStore((s) => s.setPage);
  const taskText = useDemoStore((s) => s.taskText);
  const replay = useDemoStore(selectActiveReplay);

  // 回放任务用快照派生的场景（后端给什么展示什么），普通任务按需求文本推导
  const scenario = replay?.scenario ?? deriveScenario(taskText);
  const {
    context: councilContext,
    discussion,
    options: councilOptions,
    evidenceRefs,
    riskSignals,
    recommendedReason,
  } = scenario.council;

  const [selectedId, setSelectedId] = useState(
    councilOptions.find((o) => o.recommended)?.id ?? councilOptions[0]?.id ?? '',
  );
  const [verdict, setVerdict] = useState<CouncilVerdict>('select');

  // 后端未给 Council 数据（回放任务 Gate 直通）→ 只呈现该事实，不用 mock 议程顶替
  if (councilOptions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Scale className="h-8 w-8 text-slate-600" />
        <div className="font-display text-base font-semibold text-slate-300">
          {councilContext.title}
        </div>
        <p className="max-w-sm text-xs text-slate-500">{councilContext.description}</p>
        <button
          onClick={() => setPage('tasks')}
          className="mt-2 rounded-md border border-line-bright px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-ink-800"
        >
          返回 Task Board
        </button>
      </div>
    );
  }

  const selectedOption = findOption(scenario, selectedId)!;
  const verdictDef = verdictDefs.find((v) => v.id === verdict)!;
  // 仅 verdict=select 驱动主链路继续（select + delegated → MergeAuthorization）
  const canAdvance = verdict === 'select';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-line px-6 py-4">
        <div className="callsign mb-1 text-[10px] text-violet-300">// 03 · 裁决 · N14</div>
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-5 w-5 text-violet-400" />
          <h1 className="font-display text-lg font-semibold tracking-tight text-white">
            Council Board
          </h1>
          <Badge variant="violet">pending_council · 等待裁决</Badge>
          <span className="font-mono text-[10px] text-slate-500">
            council_id={councilContext.councilId} · decision_mode=
            {councilContext.decisionMode}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{councilContext.description}</p>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: Agent Discussion */}
        <SidePanel
          side="left"
          title="Agent Discussion"
          defaultWidth={300}
          minWidth={220}
          maxWidth={460}
          storageKey="council-discussion"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={MessagesSquare}>Agent Discussion</PanelTitle>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {discussion.map((d, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border border-slate-800 border-l-4 p-3',
                    accentColor[d.accent],
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-100">{d.agent}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">{d.role}</span>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-300">{d.message}</p>
                </div>
              ))}
            </div>
          </div>
        </SidePanel>

        {/* Middle: Option Comparison */}
        <div className="flex min-w-0 flex-1 min-h-0 flex-col">
          <PanelTitle icon={Scale}>Option Comparison</PanelTitle>
          <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 xl:grid-cols-3">
            {councilOptions.map((opt) => {
              const active = selectedId === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setSelectedId(opt.id)}
                  className={cn(
                    'flex flex-col rounded-md border p-4 text-left transition-all',
                    active
                      ? 'border-violet-500/60 bg-violet-600/10 ring-1 ring-violet-500/40'
                      : 'border-line bg-ink-850/60 hover:border-line-bright',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-white">
                      {opt.title}
                    </span>
                    {opt.recommended && (
                      <Badge variant="violet" className="shrink-0">
                        <Star className="h-3 w-3" /> 推荐
                      </Badge>
                    )}
                  </div>
                  <span className="mt-0.5 text-[11px] text-slate-500">
                    提出者：{opt.proposedBy}
                  </span>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{opt.summary}</p>

                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
                        <ThumbsUp className="h-3 w-3" /> 优点
                      </div>
                      <ul className="space-y-0.5 text-slate-400">
                        {opt.pros.map((p) => (
                          <li key={p}>· {p}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-rose-300">
                        <AlertTriangle className="h-3 w-3" /> 风险
                      </div>
                      <ul className="space-y-0.5 text-slate-400">
                        {opt.risks.map((r) => (
                          <li key={r}>· {r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-blue-300">
                      <FileCode2 className="h-3 w-3" /> 影响文件
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {opt.impactedFiles.map((f) => (
                        <span
                          key={f}
                          className="rounded bg-ink-900/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3 border-t border-slate-800 pt-2">
                    <div className="mb-1 text-[11px] font-semibold text-slate-400">Agent 评分</div>
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

        {/* Right: CouncilDecision composer */}
        <SidePanel
          side="right"
          title="Human Decision"
          defaultWidth={340}
          minWidth={280}
          maxWidth={520}
          storageKey="council-decision"
        >
          <div className="flex h-full min-h-0 flex-col">
            <PanelTitle icon={Gavel}>Human Decision · CouncilDecision</PanelTitle>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* verdict selector */}
              <div>
                <div className="callsign mb-1.5 text-[9px] text-slate-500">verdict · 裁决类型</div>
                <div className="space-y-1.5">
                  {verdictDefs.map((v) => {
                    const active = verdict === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setVerdict(v.id)}
                        disabled={!!confirmedId}
                        className={cn(
                          'w-full rounded-md border p-2.5 text-left transition-all disabled:opacity-60',
                          active
                            ? 'border-violet-500/60 bg-violet-600/10 ring-1 ring-violet-500/40'
                            : 'border-line bg-ink-850/60 hover:border-line-bright',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'font-mono text-[11px] font-semibold',
                              active ? 'text-violet-200' : 'text-slate-300',
                            )}
                          >
                            {v.label}
                          </span>
                          <span className="font-mono text-[9px] text-slate-500">{v.landing}</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-snug text-slate-500">{v.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* selected_proposal_id — only meaningful for verdict=select */}
              {verdict === 'select' && (
                <div>
                  <div className="callsign mb-1 text-[9px] text-slate-500">
                    selected_proposal_id
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-2.5">
                    <span className="font-mono text-[11px] text-violet-200">
                      {selectedOption.id}
                    </span>
                    <span className="text-xs text-slate-300">{selectedOption.title}</span>
                    {selectedOption.recommended && (
                      <Badge variant="violet" className="ml-auto">
                        <Star className="h-3 w-3" /> 推荐
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                    {selectedOption.recommended
                      ? recommendedReason
                      : '该方案非系统推荐，确认前请评估其风险与维护成本。'}
                  </p>
                </div>
              )}

              {/* evidence_refs */}
              <div>
                <div className="callsign mb-1.5 flex items-center gap-1 text-[9px] text-cyan-300">
                  <Link2 className="h-3 w-3" /> evidence_refs · {evidenceRefs.length}
                </div>
                <div className="space-y-1">
                  {evidenceRefs.map((ref) => (
                    <div
                      key={ref}
                      className="truncate rounded border border-cyan-500/20 bg-cyan-500/5 px-2 py-1 font-mono text-[10px] text-cyan-200"
                    >
                      {ref}
                    </div>
                  ))}
                </div>
              </div>

              {/* risk_signals */}
              <div>
                <div className="callsign mb-1.5 flex items-center gap-1 text-[9px] text-rose-300">
                  <ShieldAlert className="h-3 w-3" /> risk_signals · {riskSignals.length}
                </div>
                <ul className="space-y-1">
                  {riskSignals.map((r) => (
                    <li key={r} className="flex gap-1.5 text-[10px] leading-snug text-rose-100/80">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {confirmedId && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-600/10 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  verdict=select · 已采纳 {findOption(scenario, confirmedId)?.title}， 生成
                  MergeAuthorization，任务流已继续。
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-line p-4">
              <div className="callsign mb-1 text-[9px] text-human/80">
                ▸ 最终裁决权属于你 · 落点 {verdictDef.landing}
              </div>
              {canAdvance ? (
                <Button
                  variant="warning"
                  className="w-full"
                  disabled={!!confirmedId}
                  onClick={() => confirmCouncilOption(selectedId)}
                >
                  <Gavel className="h-4 w-4" />
                  提交 select · 采纳 {selectedOption.id}
                </Button>
              ) : (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-200/90">
                  该裁决会使任务进入 <span className="font-mono">{verdictDef.landing}</span>
                  ，演示主链路在此暂停（仅 select 会继续到 N15 合并授权）。
                </div>
              )}
              <Button variant="outline" className="w-full" onClick={() => setPage('tasks')}>
                <ArrowLeft className="h-4 w-4" /> 返回 Task Board
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
    <div className="callsign flex items-center gap-2 border-b border-line px-4 py-3 text-[10px] text-slate-400">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] text-slate-500">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-violet-500" style={{ width: `${value * 10}%` }} />
      </div>
      <span className="w-5 shrink-0 text-right text-[10px] font-medium text-slate-300">
        {value}
      </span>
    </div>
  );
}

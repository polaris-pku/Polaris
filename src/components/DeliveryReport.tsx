import {
  FileCheck2,
  FileCode2,
  FlaskConical,
  Hand,
  Scale,
  AlertTriangle,
  GitCompare,
  Check,
  Undo2,
  Repeat,
} from 'lucide-react';
import { selectActiveReplay, useDemoStore } from '@/store/useDemoStore';
import { deriveScenario, findOption } from '@/data/scenario';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { InterventionScope } from '@/types';

const scopeLabels: Record<InterventionScope, string> = {
  current_step: '仅当前步骤',
  current_agent: '当前 Agent 后续',
  whole_workflow: '整个 Workflow',
  project_rule: '项目长期规则',
};

export function DeliveryReport() {
  const rules = useDemoStore((s) => s.interventionRules);
  const confirmedId = useDemoStore((s) => s.confirmedCouncilOptionId);
  const resetDemo = useDemoStore((s) => s.resetDemo);
  const taskText = useDemoStore((s) => s.taskText);
  const replay = useDemoStore(selectActiveReplay);
  // 回放任务用真实 run 的交付数据（worktree/产物/耗时），普通任务按需求文本推导
  const scenario = replay?.scenario ?? deriveScenario(taskText);
  const deliveryReport = scenario.delivery;
  const confirmedOption = findOption(scenario, confirmedId) ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-300">
            <FileCheck2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-white">Delivery Report</h2>
            <p className="text-xs text-slate-500">AI 工程团队任务交付汇报</p>
          </div>
          <Badge variant="green" className="ml-auto">
            已完成
          </Badge>
        </div>
      </div>

      <div className="flex-1 space-y-5 p-5">
        {/* Summary */}
        <Section icon={FileCheck2} title="任务完成摘要" tone="emerald">
          <p className="text-xs leading-relaxed text-slate-300">{deliveryReport.summary}</p>
        </Section>

        {/* Changed files */}
        <Section icon={FileCode2} title="修改文件" tone="blue">
          <div className="space-y-1.5">
            {deliveryReport.changedFiles.map((f) => (
              <div
                key={f}
                className="flex items-center gap-2 rounded-md border border-slate-800 bg-ink-900/60 px-2.5 py-1.5 font-mono text-[11px] text-slate-300"
              >
                <FileCode2 className="h-3.5 w-3.5 text-slate-500" />
                {f}
              </div>
            ))}
          </div>
        </Section>

        {/* Test result（回放任务：本次 run 后端未提供测试数据 → 如实说明，不显示编造的 0） */}
        {replay ? (
          <Section icon={FlaskConical} title="测试结果" tone="emerald">
            <p className="text-xs text-slate-500">本次 run 未提供测试数据。</p>
          </Section>
        ) : (
          <Section icon={FlaskConical} title="测试结果" tone="emerald">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="通过" value={`${deliveryReport.testResult.passed}`} tone="emerald" />
              <Stat label="失败" value={`${deliveryReport.testResult.failed}`} tone="slate" />
              <Stat label="覆盖率" value={deliveryReport.testResult.coverageDelta} tone="blue" />
            </div>
          </Section>
        )}

        {/* Intervention record */}
        <Section icon={Hand} title="用户介入记录" tone="amber">
          {rules.length === 0 ? (
            <p className="text-xs text-slate-500">本次任务无用户介入。</p>
          ) : (
            <div className="space-y-2">
              {rules.map((r, i) => (
                <div key={i} className="rounded-md border border-human/30 bg-human/5 p-2.5">
                  <p className="text-xs text-human-soft">{r.text}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="amber">{scopeLabels[r.scope]}</Badge>
                    {r.affectedAgents.map((a) => (
                      <Badge key={a} variant="slate">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Council decision */}
        <Section icon={Scale} title="Council 决策记录 · CouncilDecision" tone="violet">
          {confirmedOption ? (
            <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="violet">verdict=select</Badge>
                <span className="font-mono text-[10px] text-slate-500">
                  selected_proposal_id={confirmedOption.id}
                </span>
                <span className="w-full text-sm font-semibold text-violet-200">
                  {confirmedOption.title}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-slate-300">{confirmedOption.summary}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">本次任务未触发 Council 裁决。</p>
          )}
        </Section>

        {/* Risk notes */}
        <Section icon={AlertTriangle} title="风险与建议" tone="rose">
          <ul className="space-y-1.5">
            {deliveryReport.riskNotes.map((n) => (
              <li key={n} className="flex gap-2 text-xs text-rose-100/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                {n}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div className="sticky bottom-0 border-t border-slate-800/80 bg-ink-850/95 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm">
            <GitCompare className="h-4 w-4" /> View Diff
          </Button>
          <Button variant="success" size="sm">
            <Check className="h-4 w-4" /> Accept Changes
          </Button>
          <Button variant="outline" size="sm">
            <Undo2 className="h-4 w-4" /> Request Revision
          </Button>
          <Button variant="primary" size="sm" onClick={resetDemo}>
            <Repeat className="h-4 w-4" /> Run Another Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}

const toneMap = {
  emerald: 'text-emerald-300',
  blue: 'text-command-soft',
  amber: 'text-human',
  violet: 'text-violet-300',
  rose: 'text-rose-300',
  slate: 'text-slate-300',
};

function Section({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: typeof FileCheck2;
  title: string;
  tone: keyof typeof toneMap;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className={`callsign mb-2 flex items-center gap-1.5 text-[10px] ${toneMap[tone]}`}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof toneMap;
}) {
  return (
    <div className="rounded-md border border-line bg-ink-900/60 p-2.5 text-center">
      <div className={`font-mono text-lg font-bold tabular ${toneMap[tone]}`}>{value}</div>
      <div className="callsign mt-0.5 text-[8px] text-slate-500">{label}</div>
    </div>
  );
}

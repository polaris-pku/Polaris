import { BarChart3, BookOpen, Check, Plus, UserCircle2, UserSquare2, Wrench } from 'lucide-react';
import type { Agent } from '@/types';
import type { ExperienceView, SkillView } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { AgentStatusPill } from '@/components/StatusPill';
import { calculateDerivedMetrics, pct, ratio } from '@/lib/agentMetrics';
import { cn } from '@/lib/utils';

type Props = {
  agent: Agent | null;
  assigned: boolean;
  onAssign: () => void;
  showAssign?: boolean;
};

/**
 * Agent 详情 —— 对齐方向 B `AgentBoardAgentView`：头部 + persona 画像（常驻）
 * + 指标（raw + derived，折叠）+ 技能/经验列表（折叠懒展开）。
 * 只呈现 B 刻画的字段；运行态 session/lease 属 A/C，不在此。
 */
export function AgentDetailPanel({ agent, assigned, onAssign, showAssign = true }: Props) {
  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
        <UserCircle2 className="mb-3 h-10 w-10 text-slate-700" />
        <p className="text-sm">选择左侧任意 Agent</p>
        <p className="text-xs text-slate-600">查看画像、指标与技能/经验</p>
      </div>
    );
  }

  const { persona, metrics } = agent;
  const derived = calculateDerivedMetrics(metrics);

  return (
    // key=agent.id：切换 Agent 时重置各折叠区开合
    <div key={agent.id} className="flex h-full flex-col">
      {/* 头部：身份 + persona 摘要（常驻） */}
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-line-bright bg-gradient-to-br from-command/25 to-violet-500/15 font-mono text-base font-bold text-command-soft">
            {agent.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold text-white">
              {agent.name}
            </div>
            <div className="truncate font-mono text-[10px] text-slate-500">{agent.role_id}</div>
          </div>
          <div className="ml-auto shrink-0">
            <AgentStatusPill status={agent.status} />
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-300">{persona.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.tags.map((t) => (
            <span
              key={t}
              className="rounded border border-teal-500/25 bg-teal-500/5 px-1.5 py-0.5 font-mono text-[10px] text-teal-200/90"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {/* —— persona 画像（常驻展开） —— */}
        <Collapsible
          icon={UserSquare2}
          title="角色画像"
          gloss="Persona"
          meta={`v${persona.version}`}
          accent="text-violet-300"
          defaultOpen
        >
          <dl className="space-y-2 text-[11px] leading-relaxed">
            <PersonaRow label="技能覆盖" value={persona.skills_overview} />
            <PersonaRow label="经验覆盖" value={persona.experience_coverage} />
            <PersonaRow label="近期表现" value={persona.recent_performance} />
            <PersonaRow label="补充说明" value={persona.notes} />
          </dl>
          <p className="mt-2.5 border-t border-slate-800/80 pt-2 font-mono text-[9px] text-slate-600">
            生成于 {fmtTime(persona.generated_at)}
          </p>
        </Collapsible>

        {/* —— 指标：派生打头 + 原始明细 —— */}
        <Collapsible icon={BarChart3} title="能力指标" gloss="Metrics" accent="text-sky-300">
          {/* 派生指标（实时算） */}
          <div className="grid grid-cols-2 gap-1.5">
            <Metric label="任务成功率" value={pct(derived.success_rate)} accent />
            <Metric label="投标胜率" value={pct(derived.bid_win_rate)} accent />
            <Metric label="平均置信度" value={pct(metrics.avg_confidence)} />
            <Metric label="活跃度" value={ratio(derived.activity_score)} />
            <Metric label="经验密度" value={ratio(derived.experience_density)} />
            <Metric label="技能密度" value={ratio(derived.skill_density)} />
          </div>

          {/* 原始计数 */}
          <dl className="mt-2.5 space-y-1 border-t border-slate-800/80 pt-2.5 font-mono text-[10px]">
            <RawRow
              k="任务 总/中标/胜出"
              v={`${metrics.total_tasks} / ${metrics.tasks_bid} / ${metrics.tasks_won}`}
            />
            <RawRow
              k="完成 成功/部分/失败"
              v={`${metrics.tasks_succeeded} / ${metrics.tasks_partial} / ${metrics.tasks_failed}`}
            />
            <RawRow
              k="技能 (导入/晋升)"
              v={`${metrics.skill_count}（${metrics.imported_skill_count}/${metrics.promoted_skill_count}）`}
            />
            <RawRow k="经验数" v={`${metrics.experience_count}`} />
            <RawRow k="累计 token" v={fmtTokens(metrics.token_cost_total)} />
            {metrics.persona_drift !== undefined && (
              <RawRow k="Persona 漂移" v={ratio(metrics.persona_drift)} />
            )}
            {metrics.last_task_at && <RawRow k="最近任务" v={fmtTime(metrics.last_task_at)} />}
          </dl>
        </Collapsible>

        {/* —— 技能列表（折叠） —— */}
        <Collapsible
          icon={Wrench}
          title="技能"
          gloss="Skills"
          meta={`${metrics.skill_count} 条`}
          accent="text-emerald-300"
        >
          {agent.skills.length === 0 ? (
            <p className="text-[11px] text-slate-600">暂无沉淀技能。</p>
          ) : (
            <ul className="space-y-2">
              {agent.skills.map((s) => (
                <SkillItem key={s.id} skill={s} />
              ))}
            </ul>
          )}
        </Collapsible>

        {/* —— 经验列表（折叠） —— */}
        <Collapsible
          icon={BookOpen}
          title="经验"
          gloss="Experiences"
          meta={`${metrics.experience_count} 条`}
          accent="text-amber-300"
        >
          {agent.experiences.length === 0 ? (
            <p className="text-[11px] text-slate-600">暂无沉淀经验。</p>
          ) : (
            <ul className="space-y-2">
              {agent.experiences.map((e) => (
                <ExperienceItem key={e.id} exp={e} />
              ))}
            </ul>
          )}
        </Collapsible>
      </div>

      {showAssign && (
        <div className="border-t border-slate-800/80 p-4">
          <Button variant={assigned ? 'success' : 'primary'} className="w-full" onClick={onAssign}>
            {assigned ? (
              <>
                <Check className="h-4 w-4" /> 已加入项目团队
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Assign to Project
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function PersonaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-300">{value}</dd>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-ink-900/60 px-2.5 py-2">
      <div className="text-[9px] text-slate-500">{label}</div>
      <div
        className={cn(
          'font-mono text-sm font-semibold tabular',
          accent ? 'text-command-soft' : 'text-slate-200',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RawRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="min-w-0 truncate text-right text-slate-300">{v}</span>
    </div>
  );
}

function SkillItem({ skill }: { skill: SkillView }) {
  return (
    <li className="rounded-md border border-slate-800 bg-ink-900/40 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-slate-200">{skill.description}</span>
        <span className="shrink-0 font-mono text-[9px] text-slate-600">{skill.version}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <ReviewBadge status={skill.review_status} />
        {skill.promoted_from && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-px font-mono text-[9px] text-emerald-300/80">
            晋升自 {skill.promoted_from}
          </span>
        )}
        {skill.tags.map((t) => (
          <span key={t} className="font-mono text-[9px] text-slate-600">
            #{t}
          </span>
        ))}
      </div>
    </li>
  );
}

function ExperienceItem({ exp }: { exp: ExperienceView }) {
  const positive = exp.type === 'positive';
  return (
    <li className="rounded-md border border-slate-800 bg-ink-900/40 p-2.5">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full',
            positive ? 'bg-emerald-400' : 'bg-rose-400',
          )}
        />
        <span className="text-[11px] leading-relaxed text-slate-300">{exp.description}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-3.5 font-mono text-[9px] text-slate-600">
        <span className={positive ? 'text-emerald-300/70' : 'text-rose-300/70'}>
          {positive ? 'positive' : 'negative'}
        </span>
        <span>置信 {pct(exp.confidence)}</span>
        <span>引用 {exp.referenced_count}</span>
      </div>
    </li>
  );
}

function ReviewBadge({ status }: { status: string }) {
  const approved = status === 'approved';
  return (
    <span
      className={cn(
        'rounded px-1.5 py-px font-mono text-[9px]',
        approved ? 'bg-emerald-500/10 text-emerald-300/80' : 'bg-slate-700/50 text-slate-400',
      )}
    >
      {status}
    </span>
  );
}

/** ISO → 简短本地时间（仅展示，不参与逻辑）。 */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** token 总量 → 紧凑文案（K/M）。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

import { Check, Plus, UserCircle2 } from 'lucide-react';
import type { Agent } from '@/types';
import type { ExperienceView, SkillView } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Fold } from '@/components/ui/Fold';
import { EmptyState } from '@/components/ui/EmptyState';
import { AgentStatusPill } from '@/components/StatusPill';
import { calculateDerivedMetrics, pct, ratio } from '@/lib/agentMetrics';
import { roleName } from '@/lib/roleNames';
import { cn } from '@/lib/utils';

type Props = {
  agent: Agent | null;
  assigned: boolean;
  onAssign: () => void;
  showAssign?: boolean;
};

/**
 * Agent 详情：头部（身份 + persona 摘要，常驻）+ 四个 Fold（画像 / 指标 / 技能 / 经验）。
 *
 * 原来这里用的是旧折叠原语的双语注音 prop —— 一个 prop 造出了 4 个双语标题
 * （`角色画像 Persona` / `能力指标 Metrics` / …）。那个原语和那个 prop 都已删除，
 * 折叠的唯一容器是 `Fold`：D1 说人话（恒 32px），D2 说结构。
 */
export function AgentDetailPanel({ agent, assigned, onAssign, showAssign = true }: Props) {
  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <EmptyState
          icon={UserCircle2}
          title="选择左侧任意 Agent"
          hint="查看画像、指标与技能/经验"
        />
      </div>
    );
  }

  const { persona, metrics } = agent;
  const derived = calculateDerivedMetrics(metrics);

  return (
    // key=agent.id：切换 Agent 时重置各折叠区开合
    <div key={agent.id} className="flex h-full flex-col bg-black">
      {/* 头部：身份 + persona 摘要（常驻） */}
      <div className="border-b border-edge p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-panel border border-edge-strong bg-surface-raised font-mono text-title text-command-soft">
            {agent.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div className="min-w-0">
            <div className="truncate text-title text-fg-primary">{agent.name}</div>
            <div className="truncate text-body text-fg-muted">{roleName(agent.role_id)}</div>
          </div>
          <div className="ml-auto shrink-0">
            <AgentStatusPill status={agent.status} />
          </div>
        </div>
        <p className="mt-3 text-body text-fg-secondary">{persona.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.tags.map((t) => (
            <span
              key={t}
              className="rounded-chip border border-edge bg-surface-raised px-1.5 font-mono text-code text-fg-secondary"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* —— 角色画像（默认展开） —— */}
        <Fold id="agent-persona" title="角色画像" meta={`v${persona.version}`} defaultOpen>
          <dl className="space-y-2 text-body">
            <PersonaRow label="技能覆盖" value={persona.skills_overview} />
            <PersonaRow label="经验覆盖" value={persona.experience_coverage} />
            <PersonaRow label="近期表现" value={persona.recent_performance} />
            <PersonaRow label="补充说明" value={persona.notes} />
          </dl>
          <p className="mt-2 border-t border-edge pt-2 text-body text-fg-faint">
            生成于 {fmtTime(persona.generated_at)}
          </p>
        </Fold>

        {/* —— 能力指标：派生打头 + 原始明细 —— */}
        <Fold id="agent-metrics" title="能力指标">
          <div className="grid grid-cols-2 gap-1.5">
            <Metric label="任务成功率" value={pct(derived.success_rate)} accent />
            <Metric label="中标率" value={pct(derived.bid_win_rate)} accent />
            <Metric label="平均置信度" value={pct(metrics.avg_confidence)} />
            <Metric label="活跃度" value={ratio(derived.activity_score)} />
            <Metric label="经验密度" value={ratio(derived.experience_density)} />
            <Metric label="技能密度" value={ratio(derived.skill_density)} />
          </div>

          <dl className="mt-2 space-y-1 border-t border-edge pt-2">
            <RawRow
              k="任务 总/中标/胜出"
              v={`${metrics.total_tasks} / ${metrics.tasks_bid} / ${metrics.tasks_won}`}
            />
            <RawRow
              k="完成 成功/部分/失败"
              v={`${metrics.tasks_succeeded} / ${metrics.tasks_partial} / ${metrics.tasks_failed}`}
            />
            <RawRow
              k="技能（导入/晋升）"
              v={`${metrics.skill_count}（${metrics.imported_skill_count}/${metrics.promoted_skill_count}）`}
            />
            <RawRow k="经验数" v={`${metrics.experience_count}`} />
            <RawRow k="累计消耗" v={`${fmtTokens(metrics.token_cost_total)} tokens`} />
            {metrics.persona_drift !== undefined && (
              <RawRow k="画像漂移" v={ratio(metrics.persona_drift)} />
            )}
            {metrics.last_task_at && <RawRow k="最近任务" v={fmtTime(metrics.last_task_at)} />}
          </dl>
        </Fold>

        {/* —— 技能 —— */}
        <Fold id="agent-skills" title="技能" fact={`${metrics.skill_count} 条`}>
          {agent.skills.length === 0 ? (
            <p className="text-body text-fg-faint">暂无沉淀技能。</p>
          ) : (
            <ul className="space-y-2">
              {agent.skills.map((s) => (
                <SkillItem key={s.id} skill={s} />
              ))}
            </ul>
          )}
        </Fold>

        {/* —— 经验 —— */}
        <Fold id="agent-experiences" title="经验" fact={`${metrics.experience_count} 条`}>
          {agent.experiences.length === 0 ? (
            <p className="text-body text-fg-faint">暂无沉淀经验。</p>
          ) : (
            <ul className="space-y-2">
              {agent.experiences.map((e) => (
                <ExperienceItem key={e.id} exp={e} />
              ))}
            </ul>
          )}
        </Fold>
      </div>

      {showAssign && (
        <div className="border-t border-edge p-4">
          <Button
            variant={assigned ? 'secondary' : 'primary'}
            className="w-full"
            onClick={onAssign}
          >
            {assigned ? (
              <>
                <Check className="h-4 w-4" /> 已加入团队
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> 加入团队
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
      <dt className="text-body text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-body text-fg-secondary">{value}</dd>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-panel border border-edge bg-surface-panel px-2 py-1">
      <div className="text-body text-fg-muted">{label}</div>
      <div
        className={cn(
          'tabular font-mono text-title',
          accent ? 'text-command-soft' : 'text-fg-primary',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RawRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-body">
      <span className="shrink-0 text-fg-muted">{k}</span>
      <span className="tabular min-w-0 truncate text-right font-mono text-code text-fg-secondary">
        {v}
      </span>
    </div>
  );
}

function SkillItem({ skill }: { skill: SkillView }) {
  return (
    <li className="rounded-panel border border-edge bg-surface-panel p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-body text-fg-primary">{skill.description}</span>
        <span className="tabular shrink-0 font-mono text-code text-fg-faint">{skill.version}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <ReviewBadge status={skill.review_status} />
        {skill.promoted_from && (
          <span className="rounded-chip bg-surface-raised px-1.5 text-body text-fg-secondary">
            晋升自 {skill.promoted_from}
          </span>
        )}
        {skill.tags.map((t) => (
          <span key={t} className="font-mono text-code text-fg-faint">
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
    <li className="rounded-panel border border-edge bg-surface-panel p-2">
      <div className="flex items-start gap-2">
        <span
          className={cn('mt-2 h-1.5 w-1.5 shrink-0 rounded-full', positive ? 'bg-ok' : 'bg-danger')}
        />
        <span className="text-body text-fg-secondary">{exp.description}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3 pl-3.5 text-body text-fg-muted">
        <span className={positive ? 'text-ok' : 'text-danger'}>{positive ? '正向' : '负向'}</span>
        <span>
          置信 <span className="tabular">{pct(exp.confidence)}</span>
        </span>
        <span>
          引用 <span className="tabular">{exp.referenced_count}</span>
        </span>
      </div>
    </li>
  );
}

/** 技能的评审状态 —— 后端给的是 enum 原文，主层只呈现它的两种含义。 */
function ReviewBadge({ status }: { status: string }) {
  const approved = status === 'approved';
  return (
    <span
      className={cn(
        'rounded-chip px-1.5 text-body',
        approved ? 'bg-ok/10 text-ok-soft' : 'bg-surface-raised text-fg-muted',
      )}
    >
      {approved ? '已核准' : '待核准'}
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

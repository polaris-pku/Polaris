import { Check, Plus, Star } from 'lucide-react';
import type { Agent } from '@/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AgentStatusPill } from '@/components/StatusPill';
import { cn } from '@/lib/utils';

type Props = {
  agent: Agent;
  selected: boolean;
  assigned: boolean;
  onSelect: () => void;
  onAssign: () => void;
  showAssign?: boolean;
  recommended?: boolean;
};

/** 生命周期状态 → 状态灯颜色（与 StatusPill 同一语义）。 */
const statusLed: Record<Agent['status'], string> = {
  created: 'bg-slate-500',
  active: 'bg-emerald-400',
  idle: 'bg-slate-500',
  draining: 'bg-amber-400',
  retired: 'bg-violet-400',
};

/**
 * Agent 卡片 —— 对齐方向 B `AgentBoardListItem`（轻量摘要）：
 * 身份 + 生命周期 + 一句 persona 摘要 + tags + 技能/经验计数。
 * 指标簇/协作/token 属详情，卡片不铺陈。
 */
export function AgentCard({
  agent,
  selected,
  assigned,
  onSelect,
  onAssign,
  showAssign = true,
  recommended = false,
}: Props) {
  const initials = agent.name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');

  return (
    <Card
      onClick={onSelect}
      className={cn(
        'cursor-pointer overflow-hidden transition-all hover:border-line-bright',
        recommended && !selected && 'border-violet-500/40',
        selected && 'border-command/60 shadow-glow',
        assigned && 'bg-command/[0.04]',
      )}
    >
      <div className="p-4">
        {/* 身份行：头像 + 名称/role_id + 状态 */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line-bright bg-gradient-to-br from-command/25 to-violet-500/15 font-mono text-sm font-bold text-command-soft">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-display text-sm font-semibold text-slate-100">
                {agent.name}
              </span>
              {recommended && (
                <Badge variant="violet">
                  <Star className="h-2.5 w-2.5" /> 推荐
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
              {agent.role_id}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cn('led h-1.5 w-1.5', statusLed[agent.status])} />
            <AgentStatusPill status={agent.status} />
          </span>
        </div>

        {/* persona 一句摘要 */}
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-400">
          {agent.persona.summary}
        </p>

        {/* tags + 技能/经验计数 */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {agent.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="rounded border border-teal-500/25 bg-teal-500/5 px-1.5 py-0.5 font-mono text-[10px] text-teal-200/90"
              >
                {t}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-slate-500">
            <span className="tabular" title="技能数">
              技 {agent.metrics.skill_count}
            </span>
            <span className="tabular" title="经验数">
              验 {agent.metrics.experience_count}
            </span>
          </div>
        </div>

        {showAssign && (
          <Button
            variant={assigned ? 'success' : 'primary'}
            size="sm"
            className="mt-4 w-full"
            onClick={(e) => {
              e.stopPropagation();
              onAssign();
            }}
          >
            {assigned ? (
              <>
                <Check className="h-4 w-4" /> 已加入项目
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Assign to Project
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}

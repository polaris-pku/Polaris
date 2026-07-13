import { Check, Plus, Star } from 'lucide-react';
import type { Agent } from '@/types';
import { Panel } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AgentStatusPill } from '@/components/StatusPill';
import { roleName } from '@/lib/roleNames';
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

/**
 * 生命周期状态 → 状态灯颜色（与 StatusPill 同一语义）。
 * 6 色状态板已删：颜色只编码状态，其余一律中性。
 */
const statusLed: Record<Agent['status'], string> = {
  created: 'bg-fg-faint',
  active: 'bg-ok',
  idle: 'bg-fg-faint',
  draining: 'bg-human',
  retired: 'bg-fg-faint',
};

/**
 * Agent 卡片：身份 + 生命周期 + 一句 persona 摘要 + tags + 技能/经验计数。
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
    <Panel
      onClick={onSelect}
      className={cn(
        // R5：一个容器只用一种方式与背景区分 —— 这里是描边。选中 = command（机器选中态），
        // 不再叠阴影（元素级 box-shadow 全灭）。
        'cursor-pointer overflow-hidden transition-colors hover:border-edge-strong',
        recommended && !selected && 'border-command/30',
        selected && 'border-command/60',
      )}
    >
      {/* 身份行：头像 + 名称/角色 + 状态 */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel border border-edge-strong bg-surface-raised font-mono text-title text-command-soft">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-title text-fg-primary">{agent.name}</span>
            {recommended && (
              <Badge variant="command">
                <Star className="h-3 w-3" /> 推荐
              </Badge>
            )}
          </div>
          {/* 主层永不显示蛇形 role_id（它是数据库主键，不是人名） */}
          <div className="mt-0.5 truncate text-body text-fg-muted">{roleName(agent.role_id)}</div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={cn('led h-1.5 w-1.5 rounded-full', statusLed[agent.status])} />
          <AgentStatusPill status={agent.status} />
        </span>
      </div>

      {/* persona 一句摘要 */}
      <p className="mt-3 line-clamp-2 text-body text-fg-secondary">{agent.persona.summary}</p>

      {/* tags + 技能/经验计数 */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {agent.tags.slice(0, 4).map((t) => (
            <span
              key={t}
              className="rounded-chip border border-edge bg-surface-raised px-1.5 font-mono text-code text-fg-secondary"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-body text-fg-muted">
          <span title="技能数">
            技能 <span className="tabular">{agent.metrics.skill_count}</span>
          </span>
          <span title="经验数">
            经验 <span className="tabular">{agent.metrics.experience_count}</span>
          </span>
        </div>
      </div>

      {showAssign && (
        <Button
          variant={assigned ? 'secondary' : 'primary'}
          size="sm"
          className="mt-4 w-full"
          onClick={(e) => {
            e.stopPropagation();
            onAssign();
          }}
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
      )}
    </Panel>
  );
}

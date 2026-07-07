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

const statusLed: Record<Agent['status'], string> = {
  idle: 'bg-slate-500',
  working: 'bg-command',
  waiting: 'bg-human',
  reviewing: 'bg-violet-400',
  done: 'bg-emerald-400',
};

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
      {/* dossier header strip — callsign + live status */}
      <div className="flex items-center justify-between border-b border-line bg-ink-900/50 px-4 py-1.5">
        <span className="flex items-center gap-1.5">
          <span className="callsign text-[9px] text-slate-500">{agent.runtime.agent_id}</span>
          {recommended && (
            <Badge variant="violet">
              <Star className="h-2.5 w-2.5" /> 推荐
            </Badge>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn('led h-1.5 w-1.5', statusLed[agent.status])} />
          <AgentStatusPill status={agent.status} />
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-line-bright bg-gradient-to-br from-command/25 to-violet-500/15 font-mono text-sm font-bold text-command-soft">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-sm font-semibold text-slate-100">
              {agent.name}
            </div>
            <div className="callsign text-[10px] text-slate-500">{agent.role}</div>
            <div className="mt-0.5 truncate font-mono text-[9px] text-slate-600">
              {agent.runtime.role_id} · {agent.runtime.driver_name}
            </div>
          </div>
        </div>

        {/* instrument cluster */}
        <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-ink-900/40">
          <Stat label="成功率" value={`${agent.successRate}%`} tone="text-emerald-300" />
          <Stat label="历史任务" value={`${agent.historicalTasks}`} tone="text-slate-100" />
          <Stat
            label="失败数"
            value={`${agent.failureCount}`}
            tone={agent.failureCount > 0 ? 'text-rose-300' : 'text-slate-100'}
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {agent.skills.slice(0, 4).map((s) => (
            <Badge key={s} variant="slate">
              {s}
            </Badge>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-slate-500">
          <span>协作 · {agent.collaboration}</span>
          <span className="tabular">{agent.tokenCost}</span>
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

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="px-2 py-2.5 text-center">
      <div className={cn('font-mono text-base font-semibold tabular', tone)}>{value}</div>
      <div className="callsign mt-0.5 text-[8px] text-slate-500">{label}</div>
    </div>
  );
}

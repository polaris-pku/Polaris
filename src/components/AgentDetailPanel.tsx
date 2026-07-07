import { Check, Plus, UserCircle2 } from 'lucide-react';
import type { Agent } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { AgentStatusPill } from '@/components/StatusPill';

type Props = {
  agent: Agent | null;
  assigned: boolean;
  onAssign: () => void;
  showAssign?: boolean;
};

export function AgentDetailPanel({ agent, assigned, onAssign, showAssign = true }: Props) {
  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
        <UserCircle2 className="mb-3 h-10 w-10 text-slate-700" />
        <p className="text-sm">选择左侧任意 Agent</p>
        <p className="text-xs text-slate-600">查看完整员工档案与历史表现</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-line-bright bg-gradient-to-br from-command/25 to-violet-500/15 font-mono text-base font-bold text-command-soft">
            {agent.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </div>
          <div>
            <div className="font-display text-base font-semibold text-white">{agent.name}</div>
            <div className="callsign text-[10px] text-slate-500">{agent.role}</div>
          </div>
          <div className="ml-auto">
            <AgentStatusPill status={agent.status} />
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">{agent.description}</p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {/* —— 已冻结：直接对齐字段清单 N4/N5/N6 —— */}
        <section>
          <SectionTitle tag="frozen">Identity &amp; Runtime · N4 / N6</SectionTitle>
          <div className="space-y-1 rounded-md border border-line bg-ink-900/60 p-2.5">
            <KV k="agent_id" v={agent.runtime.agent_id} />
            <KV k="role_id" v={agent.runtime.role_id} />
            <KV k="driver_id" v={`${agent.runtime.driver_id} · ${agent.runtime.driver_name}`} />
            <KV k="status" v={agent.status} />
            <KV k="session_id" v={agent.runtime.session_id ?? '—（未启动 Session）'} />
            <KV k="worktree_id" v={agent.runtime.worktree_id ?? '—'} />
            <KV k="last_heartbeat" v={agent.runtime.last_heartbeat ?? '—'} />
          </div>
        </section>

        <section>
          <SectionTitle tag="frozen">capability_tags · N5</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {agent.capabilityTags.map((t) => (
              <span
                key={t}
                className="rounded border border-teal-500/30 bg-teal-500/5 px-2 py-0.5 font-mono text-[10px] text-teal-200"
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle tag="frozen">file_lease · N4</SectionTitle>
          {agent.fileLease ? (
            <div className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
              <KV k="lease_id" v={agent.fileLease.lease_id} />
              <KV k="path_glob" v={agent.fileLease.path_glob} />
              <KV k="scope" v={agent.fileLease.scope} />
              <KV k="expires_at" v={agent.fileLease.expires_at} />
              <KV k="status" v={agent.fileLease.status} />
            </div>
          ) : (
            <p className="text-[11px] text-slate-600">未持有文件租约（尚未认领任务）。</p>
          )}
        </section>

        {/* —— 未冻结：B 方向画像/指标，先 mock，待 B 冻结后对齐 AgentMetrics —— */}
        <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-500/[0.03] p-2.5">
          <p className="text-[10px] leading-relaxed text-amber-200/70">
            以下为 B 方向「角色 / 记忆」域字段，字段清单中尚未冻结（persona / metrics 待 B
            定）。当前为 mock，冻结后将对齐 <span className="font-mono">AgentMetrics</span>。
          </p>
        </div>

        <section>
          <SectionTitle tag="mock">核心指标</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="成功率" value={`${agent.successRate}%`} accent />
            <Metric label="代码接受率" value={`${agent.acceptedRate}%`} accent />
            <Metric label="平均完成时间" value={agent.avgCompletionTime} />
            <Metric label="Token 成本" value={agent.tokenCost} />
            <Metric label="历史任务数" value={`${agent.historicalTasks}`} />
            <Metric label="失败记录数" value={`${agent.failureCount}`} />
          </div>
        </section>

        <section>
          <SectionTitle tag="mock">技能标签</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {agent.skills.map((s) => (
              <Badge key={s} variant="blue">
                {s}
              </Badge>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle tag="mock">协作表现</SectionTitle>
          <Badge variant="violet">{agent.collaboration}</Badge>
        </section>

        <section>
          <SectionTitle tag="mock">最近任务</SectionTitle>
          <p className="rounded-lg border border-slate-800 bg-ink-900/60 p-3 text-xs text-slate-300">
            {agent.recentTask}
          </p>
        </section>
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

function SectionTitle({ children, tag }: { children: React.ReactNode; tag?: 'frozen' | 'mock' }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="callsign text-[10px] text-slate-500">{children}</h4>
      {tag === 'frozen' && (
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px font-mono text-[8px] font-semibold uppercase text-emerald-300">
          🟢 已对齐
        </span>
      )}
      {tag === 'mock' && (
        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px font-mono text-[8px] font-semibold uppercase text-amber-300">
          mock · 待 B 冻结
        </span>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[10px]">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className="min-w-0 truncate text-right text-slate-200">{v}</span>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-ink-900/60 p-2.5">
      <div className="callsign text-[8px] text-slate-500">{label}</div>
      <div
        className={
          accent
            ? 'font-mono text-sm font-semibold tabular text-command-soft'
            : 'font-mono text-sm font-semibold tabular text-slate-200'
        }
      >
        {value}
      </div>
    </div>
  );
}

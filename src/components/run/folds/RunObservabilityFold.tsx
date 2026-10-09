import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { runApi } from '@/api/run';
import type {
  RunGetUsageParams,
  RunUsage,
  RunUsageHistory,
  RunUsageTokens,
} from '@/api/types/observability';
import { Fold } from '@/components/ui/Fold';
import { Button } from '@/components/ui/Button';
import { KeyValue } from '@/components/ui/KeyValue';
import {
  agentActivityLabel,
  observedRoleIds,
  observationError,
  stageLabel,
} from '@/lib/runObservability';
import { roleName } from '@/lib/roleNames';
import type { LiveRunState } from '@/store/types';

const count = (value: number) => value.toLocaleString('zh-CN');
const sourceLabel = (source: string) =>
  source === 'proxy' ? '模型代理' : source === 'claude_session_jsonl' ? '执行器会话账单' : source;

export function RunActivityFold({ live }: { live: LiveRunState }) {
  const agents = live.status === 'running' ? live.snapshot?.activity?.agents : undefined;
  if (!agents?.length) return null;
  const stale =
    !!live.syncError ||
    agents.some((agent) => agent.stale || (agent.state === 'delegating' && agent.driver?.stale));
  return (
    <Fold
      id="fold-run-activity"
      title="当前活动"
      fact={stale ? '观测可能已过期' : `${agents.length} 个角色`}
      status={stale ? 'idle' : 'running'}
    >
      {agents.map((agent) => {
        const driver = agent.state === 'delegating' ? agent.driver : undefined;
        return (
          <div key={agent.role_id} className="border-b border-edge py-2 last:border-b-0">
            <p className="text-body text-fg-primary">{roleName(agent.role_id)}</p>
            <KeyValue k="活动" v={agentActivityLabel(agent)} />
            <KeyValue k="开始于" v={agent.since} mono />
            {agent.round !== undefined && <KeyValue k="轮次" v={count(agent.round)} />}
            {agent.tool_name && <KeyValue k="委派工具" v={agent.tool_name} mono />}
            {agent.stale && <p className="text-body text-human">角色状态观测已陈旧。</p>}
            {driver && (
              <>
                <KeyValue k="最近活动" v={driver.last_event_at} mono />
                {driver.tool_name && <KeyValue k="执行器工具" v={driver.tool_name} mono />}
                {driver.stale && <p className="text-body text-human">执行器已较久没有新事件。</p>}
              </>
            )}
          </div>
        );
      })}
    </Fold>
  );
}

export function RunUsageFold({ live }: { live: LiveRunState }) {
  const usage = live.snapshot?.usage;
  const pending = usage?.billed?.pending_sources;
  const roles = observedRoleIds(live.snapshot, live.timeline);
  return (
    <Fold
      id="fold-run-usage"
      title="用量"
      fact={pending?.length ? '部分账单待结算' : usage ? '分口径查看' : '后端尚未提供'}
    >
      <UsageBreakdown usage={usage} />
      <UsageHistory
        key={live.runId}
        runId={live.runId}
        taskId={live.taskId}
        status={live.status}
        roles={roles}
      />
    </Fold>
  );
}

export function UsageBreakdown({ usage }: { usage: RunUsage | undefined }) {
  if (!usage || Object.keys(usage).length === 0) {
    return (
      <p className="text-body text-fg-muted">后端未提供本次运行的用量数据，不代表用量为 0。</p>
    );
  }
  return (
    <div className="space-y-3">
      {usage.billed?.metric === 'billed_tokens' && (
        <section aria-label="按来源计费用量">
          <h3 className="text-body text-fg-primary">计费 token · 按来源</h3>
          {Object.entries(usage.billed.by_source).map(([source, tokens]) =>
            tokens ? (
              <div key={source} className="mt-2">
                <p className="text-body text-fg-secondary">{sourceLabel(source)}</p>
                <TokenRows tokens={tokens} />
              </div>
            ) : null,
          )}
          {!!usage.billed.pending_sources?.length && (
            <p className="mt-1 text-body text-human">
              待结算：{usage.billed.pending_sources.map(sourceLabel).join('、')}
              ；当前数字不是完整账单。
            </p>
          )}
        </section>
      )}

      {usage.context?.metric === 'context_tokens_used' && (
        <section aria-label="上下文占用" className="border-t border-edge pt-2">
          <h3 className="text-body text-fg-primary">上下文占用 · 非计费用量</h3>
          <KeyValue k="已占用" v={`${count(usage.context.context_tokens_used)} token`} />
          {!usage.context.complete && <p className="text-body text-human">上下文观测不完整。</p>}
          {usage.context.sessions.map((session, index) => (
            <div key={session.session_id} className="mt-2">
              <KeyValue
                k={session.role_id ? roleName(session.role_id) : `会话 ${index + 1}`}
                v={`${count(session.context_tokens_used)}${
                  session.context_window_size !== undefined
                    ? ` / ${count(session.context_window_size)}`
                    : ''
                } token`}
              />
              {session.reported_cost && (
                <KeyValue
                  k="自报成本"
                  v={`${session.reported_cost.amount} ${session.reported_cost.currency}`}
                />
              )}
            </div>
          ))}
        </section>
      )}

      {usage.by_stage && Object.keys(usage.by_stage).length > 0 && (
        <section aria-label="分阶段代理用量" className="border-t border-edge pt-2">
          <h3 className="text-body text-fg-primary">分阶段 · 仅模型代理计费</h3>
          {Object.entries(usage.by_stage).map(([stage, metrics]) => (
            <div key={stage} className="mt-2">
              <KeyValue k={stageLabel(stage)} v={`${count(metrics.total_tokens)} token`} />
              <p className="text-body text-fg-muted">
                {count(metrics.llm_calls)} 次模型调用 · {count(metrics.events)} 个事件
                {metrics.duration_ms !== undefined
                  ? ` · ${count(metrics.duration_ms)} ms`
                  : ' · 耗时未提供'}
              </p>
            </div>
          ))}
        </section>
      )}
      <p className="text-body text-fg-muted">三种口径互不相加；分阶段统计不是阶段总用量。</p>
    </div>
  );
}

function TokenRows({ tokens }: { tokens: RunUsageTokens }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 text-body">
      {(
        [
          ['输入', tokens.input_tokens],
          ['输出', tokens.output_tokens],
          ['缓存写入', tokens.cache_creation_input_tokens],
          ['缓存读取', tokens.cache_read_input_tokens],
          ['计费输入', tokens.total_input_tokens],
          ['计费合计', tokens.total_tokens],
          ['调用次数', tokens.call_count],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="flex flex-wrap justify-between gap-x-2 py-0.5">
          <dt className="text-fg-muted">{label}</dt>
          <dd className="tabular text-fg-secondary">{count(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function UsageHistory({
  runId,
  taskId,
  status,
  roles,
}: {
  runId: string;
  taskId: string;
  status: LiveRunState['status'];
  roles: string[];
}) {
  const [scope, setScope] = useState('run');
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<RunUsageHistory>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const params: RunGetUsageParams =
      scope === 'system'
        ? { scope: 'system', run_id: runId }
        : scope.startsWith('role:')
          ? { scope: 'role', scope_id: scope.slice(5), run_id: runId }
          : {
              scope: scope === 'task' ? 'task' : 'run',
              scope_id: scope === 'task' ? taskId : runId,
              run_id: runId,
            };
    setHistory(undefined);
    setError(undefined);
    setLoading(true);
    void runApi
      .getUsage(params)
      .then(
        (result) => {
          if (active) setHistory(result.history);
        },
        (reason: unknown) => {
          if (active) setError(observationError(reason));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runId, taskId, scope, status, revision]);

  return (
    <section className="mt-3 border-t border-edge pt-2" aria-label="历史计费用量">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-body text-fg-secondary" htmlFor="run-usage-scope">
          历史累计
        </label>
        <select
          id="run-usage-scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          className="min-w-0 flex-1 rounded-chip border border-edge bg-surface-panel px-2 py-1 text-body text-fg-primary"
        >
          <option value="run">本次运行</option>
          <option value="task">当前任务</option>
          <option value="system">整个系统</option>
          {roles.map((role) => (
            <option key={role} value={`role:${role}`}>
              {roleName(role)}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          aria-label="刷新历史用量"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>
      {loading && (
        <p role="status" className="mt-2 text-body text-fg-muted">
          正在读取历史用量…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-body text-danger-soft">
          {error}
        </p>
      )}
      {history && (
        <div className="mt-2">
          <p className="text-body text-fg-secondary">
            {history.runs_counted} 次运行 · {history.complete ? '数据完整' : '数据不完整'}
          </p>
          {history.runs_without_usage > 0 && (
            <p className="text-body text-human">
              {history.runs_without_usage} 次运行缺少用量，未按 0 计算。
            </p>
          )}
          {history.runs_counted === 0 ? (
            <p className="text-body text-fg-muted">暂无可累计的运行数据。</p>
          ) : (
            <>
              <KeyValue k="计费累计" v={`${count(history.billed.totals.total_tokens)} token`} />
              {Object.entries(history.billed.by_source).map(([source, tokens]) =>
                tokens ? (
                  <KeyValue
                    key={source}
                    k={sourceLabel(source)}
                    v={`${count(tokens.total_tokens)} token`}
                  />
                ) : null,
              )}
            </>
          )}
          <KeyValue k="统计于" v={history.as_of} mono />
        </div>
      )}
    </section>
  );
}

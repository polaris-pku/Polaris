import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunAgentActivity, RunUsage } from '@/api/types/observability';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { BackendError } from '@/api/transport';
import { UsageBreakdown } from '@/components/run/folds/RunObservabilityFold';
import { agentActivityLabel, observationError, stageLabel } from './runObservability';
import {
  appendRunEvents,
  latestSequence,
  mergeRunSnapshot,
  snapshotRunStatus,
} from './runTimeline';

function event(id: string, sequence: number): RunEvent {
  return {
    event_id: id,
    sequence,
    run_id: 'run-1',
    task_id: 'task-1',
    type: 'driver.tool_started',
    source: 'driver',
    created_at: '2026-10-04T12:00:03Z',
    payload: {},
    schema_version: 'v0',
  };
}

describe('run timeline authority', () => {
  it('deduplicates by event_id, not by the shared sequence', () => {
    const first = event('first', 4);
    const second = event('second', 4);
    expect(appendRunEvents([first], [first, second])).toEqual([first, second]);
  });

  it('uses snapshot order for ties and retains pushes received during the request', () => {
    const first = event('first', 4);
    const snapshotOnly = event('snapshot-only', 4);
    const later = event('later', 5);
    expect(mergeRunSnapshot([snapshotOnly, first], [first, later])).toEqual([
      snapshotOnly,
      first,
      later,
    ]);
  });

  it('retains real live observations absent from the persisted snapshot', () => {
    const liveOnly = event('live-only', 2);
    const persisted = event('persisted', 3);
    expect(mergeRunSnapshot([persisted], [liveOnly, persisted])).toEqual([liveOnly, persisted]);
  });

  it('takes the maximum sequence rather than assuming the last array item is the maximum', () => {
    expect(latestSequence([event('a', 9), event('b', 4)])).toBe(9);
    expect(latestSequence([])).toBe(0);
  });

  it('uses authoritative snapshot status unless a newer terminal push raced the snapshot request', () => {
    const terminal = { ...event('completed', 5), type: 'run.completed' };
    const snapshot: RunSnapshot = {
      schema_version: 'v0',
      run_id: 'run-1',
      task_id: 'task-1',
      mode: 'single_agent',
      status: 'running',
      current: { stage: 'delivery', active_node_code: 'N18', cursor: 'deliver' },
      timeline: [terminal],
      agent_runs: [],
      artifacts: [],
      gates: [],
      errors: [],
    };
    expect(snapshotRunStatus(snapshot, [terminal])).toBe('running');
    expect(snapshotRunStatus({ ...snapshot, status: 'failed' }, [terminal])).toBe('failed');
    expect(snapshotRunStatus({ ...snapshot, timeline: [event('earlier', 4)] }, [terminal])).toBe(
      'completed',
    );
  });
});

describe('observability rendering semantics', () => {
  const render = (usage?: RunUsage) =>
    renderToStaticMarkup(createElement(UsageBreakdown, { usage }));
  it('does not turn missing usage into zero', () => {
    expect(render()).toContain('后端未提供');
    expect(render()).not.toContain('计费合计');
  });

  it('keeps billed, context, and stage measurements separate and marks missing data', () => {
    const html = render({
      billed: {
        metric: 'billed_tokens',
        by_source: {
          proxy: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 40,
            total_input_tokens: 70,
            total_tokens: 75,
            call_count: 1,
          },
        },
        pending_sources: ['claude_session_jsonl'],
      },
      context: {
        metric: 'context_tokens_used',
        context_tokens_used: 1000,
        complete: false,
        sessions: [
          {
            session_id: 's1',
            context_tokens_used: 1000,
            reported_cost: { amount: 0.000001, currency: 'USD' },
          },
        ],
      },
      by_stage: {
        execute_agent: { metric: 'proxy_billed_tokens', events: 2, llm_calls: 1, total_tokens: 75 },
        gate: {
          metric: 'proxy_billed_tokens',
          events: 0,
          llm_calls: 0,
          total_tokens: 0,
          duration_ms: 0,
        },
      },
    });
    expect(html).toContain('计费 token · 按来源');
    expect(html).toContain('上下文占用 · 非计费用量');
    expect(html).toContain('分阶段 · 仅模型代理计费');
    expect(html).toContain('三种口径互不相加');
    expect(html).toContain('待结算');
    expect(html).toContain('上下文观测不完整');
    expect(html).toContain('耗时未提供');
    expect(html).toContain('0 ms');
    expect(html).toContain('0.000001 USD');
    expect(html).not.toContain('1,150');
    expect(html).not.toContain('1,075');
  });

  it('does not confuse the agent delegation tool with its driver tool', () => {
    const agent: RunAgentActivity = {
      role_id: 'role-1',
      state: 'delegating',
      since: '2026-10-04T12:00:03Z',
      seq: 1,
      stale: false,
      tool_name: 'invoke_driver',
      driver: {
        state: 'tool_running',
        since: '2026-10-04T12:00:03Z',
        last_event_at: '2026-10-04T12:00:04Z',
        stale: false,
        tool_name: 'Edit',
      },
    };
    expect(agentActivityLabel(agent)).toBe('正在执行工具 · Edit');
    expect(agentActivityLabel({ ...agent, state: 'thinking' })).toBe('正在思考');
    expect(agentActivityLabel({ ...agent, driver: undefined })).toBe('已委派执行');
  });

  it('shows unavailable payloads and old backend errors rather than empty content', () => {
    expect(observationError(new BackendError('missing', 'run.getPayload', -32017))).toContain(
      '截断或清理',
    );
    expect(observationError(new BackendError('old', 'run.getUsage', -32601))).toContain('更新后端');
    expect(stageLabel('execute_agent')).toBe('执行任务');
    expect(stageLabel('toString')).toBe('toString');
  });
});

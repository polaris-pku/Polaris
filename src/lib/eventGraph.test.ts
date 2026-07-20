import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@/api/types/rpc';
import { buildEventGraph, groupEvents } from '@/lib/eventGraph';

let seq = 0;
const event = (type: string, payload: Record<string, unknown> = {}): RunEvent => {
  seq += 1;
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'task-1',
    type,
    source: 'coordinator',
    created_at: `2026-07-13T09:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'v0.1',
  };
};

const stepOfNode = (nodeId: string) => nodeId.slice('step-'.length).split('|')[0];

describe('eventGraph · council 事件归桶', () => {
  it('proposal / review / synthesis / failed 全部归「议会」，不落「审查」兜底桶', () => {
    const timeline = [
      event('council.started', {}),
      event('council.proposal.completed', { proposal_id: 'prop-1' }),
      event('council.review.completed', { review_ids: ['rev-1'] }),
      event('council.synthesis.completed', { synthesis_id: 'syn-1' }),
      event('council.decision', { verdict: 'select' }),
      event('council.completed', {}),
    ];
    const groups = groupEvents(timeline);
    expect(groups).toHaveLength(1);
    expect(stepOfNode(groups[0].nodeId)).toBe('council');
    expect(groups[0].events).toHaveLength(6);
  });

  it('council.failed 闭合议会跨度并把「议会」标 blocked —— 不再错标到「审查」', () => {
    const timeline = [
      event('gate.result', { decision: 'allow' }),
      event('council.started', {}),
      event('council.failed', { code: 'PROPOSAL_ROLE_FAILED' }),
    ];
    const { nodes } = buildEventGraph(timeline, 'failed');
    const council = nodes.find((n) => stepOfNode(n.id) === 'council');
    const review = nodes.find((n) => stepOfNode(n.id) === 'review');
    expect(council?.status).toBe('blocked');
    expect(review?.status).toBe('done');
  });

  it('议会摘要带出提案 / 评审计数与裁决', () => {
    const timeline = [
      event('council.started', {}),
      event('council.proposal.completed', { proposal_id: 'prop-1' }),
      event('council.proposal.completed', { proposal_id: 'prop-2' }),
      event('council.review.completed', { review_ids: ['rev-1'] }),
      event('council.synthesis.completed', { synthesis_id: 'syn-1' }),
      event('council.decision', { verdict: 'select' }),
      event('council.completed', {}),
    ];
    const { nodes } = buildEventGraph(timeline, 'completed');
    const council = nodes.find((n) => stepOfNode(n.id) === 'council');
    expect(council?.summary).toBe('裁决 select · 提案 2 · 评审 1 · 综合完成');
  });
});

describe('eventGraph · 失败状态判定', () => {
  it('agent.execution_completed + payload.status=failed → 步骤 blocked（后端失败不总带 .failed 后缀）', () => {
    const timeline = [
      event('agent.execution_requested', { role_id: 'role_ts_engineer' }),
      event('agent.execution_completed', { role_id: 'role_ts_engineer', status: 'failed' }),
    ];
    const { nodes } = buildEventGraph(timeline, 'failed');
    expect(nodes[0].status).toBe('blocked');
  });

  it('status=succeeded 不受影响，仍是 done', () => {
    const timeline = [
      event('agent.execution_requested', { role_id: 'role_ts_engineer' }),
      event('agent.execution_completed', { role_id: 'role_ts_engineer', status: 'succeeded' }),
    ];
    const { nodes } = buildEventGraph(timeline, 'completed');
    expect(nodes[0].status).toBe('done');
  });
});

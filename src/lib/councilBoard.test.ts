import { describe, expect, it } from 'vitest';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { buildCouncilBoard } from '@/lib/councilBoard';

let seq = 0;
const event = (type: string, payload: Record<string, unknown> = {}): RunEvent => {
  seq += 1;
  return {
    event_id: `evt-${String(seq)}`,
    sequence: seq,
    run_id: 'run-1',
    task_id: 'task-1',
    type,
    source: 'council',
    created_at: `2026-07-13T09:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
    schema_version: 'v0.1',
  };
};

const liveEvents = () => [
  event('council.started', { trigger: 'user_choice', decision_mode: 'advisory' }),
  event('council.proposal.completed', {
    role_id: 'proposer_a',
    proposal_id: 'prop-a',
    artifact_refs: ['artifact-1'],
  }),
  event('council.proposal.completed', { role_id: 'proposer_b', proposal_id: 'prop-b' }),
  event('council.review.completed', {
    role_id: 'reviewer',
    proposal_ids: ['prop-a', 'prop-b'],
    review_ids: ['rev-1', 'rev-2'],
  }),
];

describe('councilBoard · 事件先行', () => {
  it('没有 council 数据 → null', () => {
    expect(buildCouncilBoard([event('task.created', {})])).toBeNull();
    expect(buildCouncilBoard([])).toBeNull();
  });

  it('运行中：提案骨架来自事件，正文留空不虚构；状态 running', () => {
    const model = buildCouncilBoard(liveEvents());
    expect(model?.status).toBe('running');
    expect(model?.trigger).toBe('user_choice');
    expect(model?.decisionMode).toBe('advisory');
    expect(model?.proposals.map((p) => p.proposalId)).toEqual(['prop-a', 'prop-b']);
    expect(model?.proposals[0].roleId).toBe('proposer_a');
    expect(model?.proposals[0].artifactRefs).toEqual(['artifact-1']);
    expect(model?.proposals[0].summary).toBe('');
    expect(model?.decision).toBeNull();
    expect(model?.synthesis).toBeNull();
    expect(model?.feed).toHaveLength(4);
  });

  it('裁决事件到达即出现 decision；synthesis 事件到达即出现骨架', () => {
    const model = buildCouncilBoard([
      ...liveEvents(),
      event('council.synthesis.completed', { role_id: 'synthesizer', synthesis_id: 'syn-1' }),
      event('council.decision', {
        verdict: 'select',
        selected_proposal_id: 'prop-a',
        termination_reason: 'select',
        decision_mode: 'advisory',
      }),
      event('council.completed', { decision_id: 'dec-1', selected_artifact_refs: ['artifact-9'] }),
    ]);
    expect(model?.status).toBe('completed');
    expect(model?.synthesis?.synthesisId).toBe('syn-1');
    expect(model?.synthesis?.roleId).toBe('synthesizer');
    expect(model?.decision?.verdict).toBe('select');
    expect(model?.decision?.decisionId).toBe('dec-1');
    expect(model?.decision?.selectedArtifactRefs).toEqual(['artifact-9']);
    expect(model?.proposals.find((p) => p.proposalId === 'prop-a')?.selected).toBe(true);
    expect(model?.proposals.find((p) => p.proposalId === 'prop-b')?.selected).toBe(false);
  });

  it('select 但无 selected_proposal_id（采纳综合产出）：任何提案卡都不许标「已选中」', () => {
    // 2026-07-20 真实后端捕获：synthesis 流程的 select 采纳的是综合产出，
    // decision 事件与快照都不带 selected_proposal_id —— 别把「有裁决」推断成「选中了某提案」。
    const model = buildCouncilBoard([
      ...liveEvents(),
      event('council.decision', { verdict: 'select', termination_reason: 'select' }),
      event('council.completed', { decision_id: 'dec-1', selected_artifact_refs: ['artifact-9'] }),
    ]);
    expect(model?.decision?.verdict).toBe('select');
    expect(model?.proposals.every((p) => !p.selected)).toBe(true);
  });

  it('council.failed → status failed + code', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      event('council.failed', { code: 'REVIEW_ROLE_FAILED' }),
    ]);
    expect(model?.status).toBe('failed');
    expect(model?.failedCode).toBe('REVIEW_ROLE_FAILED');
  });
});

describe('councilBoard · 快照补全', () => {
  const council: NonNullable<RunSnapshot['council']> = {
    enabled: true,
    status: 'completed',
    verdict: 'select',
    decision_mode: 'advisory',
    decision_id: 'dec-1',
    selected_proposal_id: 'prop-b',
    selected_artifact_refs: ['artifact-9'],
    required_next_actions: ['人工验证候选文件'],
    blocked_by: [],
    can_create_merge_authorization: false,
    proposals: [
      {
        proposal_id: 'prop-a',
        agent_id: 'proposer_a',
        summary: 'proposer_a generated a council proposal.',
        affected_paths: ['snake-a.html'],
        assumptions: ['浏览器可直接打开'],
        known_risks: ['未做移动端适配'],
        completion_evidence: [],
        artifact_refs: ['artifact-1'],
      },
      { proposal_id: 'prop-b', summary: 'proposer_b generated a council proposal.' },
    ],
    reviews: [
      {
        review_id: 'rev-1',
        proposal_id: 'prop-a',
        reviewer_id: 'reviewer',
        verdict: 'approve',
        reason: 'ok',
      },
      {
        review_id: 'rev-2',
        proposal_id: 'prop-b',
        reviewer_id: 'reviewer',
        verdict: 'needs_revision',
        reason: '缺少重开一局',
      },
    ],
    synthesis: {
      synthesis_id: 'syn-1',
      synthesizer_id: 'synthesizer',
      summary: 'Synthesized final candidate.',
      artifact_refs: ['artifact-9'],
    },
  };

  it('提案正文 / 评审意见 / 综合结论按 id 合并进事件骨架；选中提案以快照为准', () => {
    const model = buildCouncilBoard(liveEvents(), council);
    const propA = model?.proposals.find((p) => p.proposalId === 'prop-a');
    expect(propA?.summary).toBe('proposer_a generated a council proposal.');
    expect(propA?.affectedPaths).toEqual(['snake-a.html']);
    expect(propA?.knownRisks).toEqual(['未做移动端适配']);
    expect(propA?.reviews).toEqual([
      { reviewId: 'rev-1', proposalId: 'prop-a', verdict: 'approve', reason: 'ok' },
    ]);
    // 快照说选中的是 prop-b（事件里没有 decision，快照为准）
    expect(propA?.selected).toBe(false);
    expect(model?.proposals.find((p) => p.proposalId === 'prop-b')?.selected).toBe(true);
    expect(model?.synthesis?.summary).toBe('Synthesized final candidate.');
    expect(model?.decision?.verdict).toBe('select');
    expect(model?.requiredNextActions).toEqual(['人工验证候选文件']);
  });

  it('只有快照没有事件（回放旧 run）：提案从快照补入，roleId 用 agent_id', () => {
    const model = buildCouncilBoard([], council);
    expect(model?.proposals.map((p) => p.proposalId).sort()).toEqual(['prop-a', 'prop-b']);
    expect(model?.proposals.find((p) => p.proposalId === 'prop-a')?.roleId).toBe('proposer_a');
    expect(model?.status).toBe('completed');
  });
});

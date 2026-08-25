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

/**
 * 提案事件的真实形状：身份来自 participantAuditPayload（**agent_id**，没有 role_id），
 * 且 payload 里就带着整份 Proposal —— 正文不必等快照。
 */
const proposalEvent = (
  seatIndex: number,
  agentId: string,
  proposalId: string,
  artifactRefs: string[],
) =>
  event('council.proposal.completed', {
    council_run_id: 'council_run_1',
    phase_id: `council_phase_p${String(seatIndex)}`,
    participant_id: `cp_p${String(seatIndex)}_aaaa111${String(seatIndex)}`,
    seat: 'proposer',
    council_seat: 'proposer',
    seat_index: seatIndex,
    agent_id: agentId,
    agent_run_id: `agent_run_p${String(seatIndex)}`,
    driver_run_result_id: `drr_p${String(seatIndex)}`,
    context_pack_ref: 'artifact_context_pack_1',
    session_id: `sess_p${String(seatIndex)}`,
    proposal_id: proposalId,
    proposal: {
      proposal_id: proposalId,
      task_id: 'task-1',
      agent_id: agentId,
      artifact_refs: artifactRefs,
      summary: `${agentId} generated a council proposal.`,
      claims: [],
      affected_paths: [`draft-${proposalId}.html`],
      assumptions: [],
      known_risks: [],
      completion_evidence: [`drr_p${String(seatIndex)}`],
      created_at: '2026-07-13T09:00:00.000Z',
      schema_version: 'v0.1',
    },
    artifact_refs: artifactRefs,
  });

const liveEvents = () => [
  event('council.started', { trigger: 'user_choice', decision_mode: 'advisory' }),
  proposalEvent(0, 'proposer_a', 'prop-a', ['artifact-1']),
  proposalEvent(1, 'proposer_b', 'prop-b', []),
  event('council.review.completed', {
    council_run_id: 'council_run_1',
    phase_id: 'council_phase_r0',
    participant_id: 'cp_r0_cccc3333',
    seat: 'reviewer',
    council_seat: 'reviewer',
    seat_index: 0,
    agent_id: 'reviewer',
    agent_run_id: 'agent_run_r0',
    driver_run_result_id: 'drr_r0',
    context_pack_ref: 'artifact_context_pack_1',
    session_id: 'sess_r0',
    proposal_ids: ['prop-a', 'prop-b'],
    review_ids: ['rev-1', 'rev-2'],
    reviews: [
      {
        review_id: 'rev-1',
        proposal_id: 'prop-a',
        reviewer_id: 'reviewer',
        verdict: 'approve',
        reason: '事件里带来的评审意见',
        unmet_criteria: [],
        evidence_refs: [],
        created_at: '2026-07-13T09:00:00.000Z',
        schema_version: 'v0.1',
      },
      {
        review_id: 'rev-2',
        proposal_id: 'prop-b',
        reviewer_id: 'reviewer',
        verdict: 'needs_revision',
        reason: '缺少重开一局',
        unmet_criteria: ['structured_review'],
        evidence_refs: [],
        created_at: '2026-07-13T09:00:00.000Z',
        schema_version: 'v0.1',
      },
    ],
    artifact_refs: [],
  }),
];

describe('councilBoard · 事件先行', () => {
  it('没有 council 数据 → null', () => {
    expect(buildCouncilBoard([event('task.created', {})])).toBeNull();
    expect(buildCouncilBoard([])).toBeNull();
  });

  it('运行中：提案与评审正文由事件自带，不必等快照；状态 running', () => {
    const model = buildCouncilBoard(liveEvents());
    expect(model?.status).toBe('running');
    expect(model?.trigger).toBe('user_choice');
    expect(model?.decisionMode).toBe('advisory');
    expect(model?.proposals.map((p) => p.proposalId)).toEqual(['prop-a', 'prop-b']);
    expect(model?.proposals[0].artifactRefs).toEqual(['artifact-1']);
    // council.proposal.completed 的 payload.proposal 就是整份 Proposal
    expect(model?.proposals[0].summary).toBe('proposer_a generated a council proposal.');
    expect(model?.proposals[0].affectedPaths).toEqual(['draft-prop-a.html']);
    expect(model?.proposals[0].completionEvidence).toEqual(['drr_p0']);
    // council.review.completed 的 payload.reviews 就是整份 Review[]
    expect(model?.proposals[0].reviews.map((r) => r.verdict)).toEqual(['approve']);
    expect(model?.proposals[1].reviews[0].reason).toBe('缺少重开一局');
    expect(model?.decision).toBeNull();
    expect(model?.synthesis).toBeNull();
    expect(model?.feed).toHaveLength(4);
  });

  it('身份来自 payload.agent_id（audit 块），不是 role_id —— 顺带带出席位', () => {
    // 2026-08 对齐 newide-scaffold@03a8f73：council.proposal.completed /
    // review.completed / synthesis.completed 展开的是 participantAuditPayload，
    // 里面只有 agent_id / participant_id / seat / council_seat / seat_index，
    // **没有 role_id**。旧实现读 payload.role_id，两份提案的标题因此长得一模一样。
    const model = buildCouncilBoard(liveEvents());
    expect(model?.proposals.map((p) => p.roleId)).toEqual(['proposer_a', 'proposer_b']);
    expect(model?.proposals.map((p) => p.seat)).toEqual(['proposer', 'proposer']);
    expect(model?.proposals[0].participantId).toBe('cp_p0_aaaa1110');
    expect(model?.proposals[0].reviews[0].reviewerId).toBe('reviewer');
    expect(model?.feed.map((f) => f.roleId)).toEqual(['', 'proposer_a', 'proposer_b', 'reviewer']);
  });

  it('事件没带 payload.proposal 时正文留空，不虚构；快照到达才补上', () => {
    const skeleton = [
      event('council.started', {}),
      event('council.proposal.completed', {
        council_run_id: 'council_run_1',
        participant_id: 'cp_p0_aaaa1110',
        seat: 'proposer',
        council_seat: 'proposer',
        seat_index: 0,
        agent_id: 'proposer_a',
        proposal_id: 'prop-a',
      }),
    ];
    const bare = buildCouncilBoard(skeleton);
    expect(bare?.proposals[0].roleId).toBe('proposer_a');
    expect(bare?.proposals[0].summary).toBe('');
    expect(bare?.proposals[0].affectedPaths).toEqual([]);
    expect(bare?.proposals[0].reviews).toEqual([]);

    const filled = buildCouncilBoard(skeleton, {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
      proposals: [{ proposal_id: 'prop-a', summary: '快照补上的正文' }],
    });
    expect(filled?.proposals[0].summary).toBe('快照补上的正文');
  });

  it('裁决事件到达即出现 decision；synthesis 事件自带正文', () => {
    const model = buildCouncilBoard([
      ...liveEvents(),
      event('council.synthesis.completed', {
        council_run_id: 'council_run_1',
        phase_id: 'council_phase_s0',
        participant_id: 'cp_s0_dddd4444',
        seat: 'synthesizer',
        council_seat: 'synthesizer',
        seat_index: 0,
        agent_id: 'synthesizer',
        agent_run_id: 'agent_run_s0',
        driver_run_result_id: 'drr_s0',
        session_id: 'sess_s0',
        synthesis_id: 'syn-1',
        synthesis: {
          synthesis_id: 'syn-1',
          task_id: 'task-1',
          synthesizer_id: 'synthesizer',
          input_proposal_ids: ['prop-a', 'prop-b'],
          input_review_ids: ['rev-1', 'rev-2'],
          artifact_refs: ['artifact-9'],
          summary: '事件里带来的综合结论',
          created_at: '2026-07-13T09:00:00.000Z',
          schema_version: 'v0.1',
        },
        artifact_refs: ['artifact-9'],
      }),
      // live 路径的 council.decision 展开的是 CouncilDecision：说理字段叫 reason，
      // 没有 termination_reason（那只有 legacy 的 integration-v0 流程才发）。
      event('council.decision', {
        council_run_id: 'council_run_1',
        decision_id: 'dec-1',
        task_id: 'task-1',
        decision_mode: 'advisory',
        selected_proposal_id: 'prop-a',
        selected_artifact_refs: ['artifact-9'],
        verdict: 'select',
        reason: 'Adopted the synthesized candidate.',
        evidence_refs: ['artifact-1'],
        can_create_merge_authorization: false,
        created_at: '2026-07-13T09:00:00.000Z',
        schema_version: 'v0.1',
        participants: [],
      }),
      event('council.completed', { decision_id: 'dec-1', selected_artifact_refs: ['artifact-9'] }),
    ]);
    expect(model?.status).toBe('completed');
    expect(model?.synthesis?.synthesisId).toBe('syn-1');
    expect(model?.synthesis?.roleId).toBe('synthesizer');
    expect(model?.synthesis?.summary).toBe('事件里带来的综合结论');
    expect(model?.synthesis?.artifactRefs).toEqual(['artifact-9']);
    expect(model?.decision?.verdict).toBe('select');
    expect(model?.decision?.decisionId).toBe('dec-1');
    expect(model?.decision?.reason).toBe('Adopted the synthesized candidate.');
    // 实跑不会有 termination_reason —— 留空，别拿 reason 顶上（那是两回事）
    expect(model?.decision?.terminationReason).toBe('');
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
    // 快照的评审意见压过事件那份（事件里 rev-1 的 reason 是「事件里带来的评审意见」）
    expect(propA?.reviews).toEqual([
      {
        reviewId: 'rev-1',
        proposalId: 'prop-a',
        reviewerId: 'reviewer',
        verdict: 'approve',
        reason: 'ok',
      },
    ]);
    // 快照的提案正文同样压过事件自带的 payload.proposal
    expect(propA?.affectedPaths).toEqual(['snake-a.html']);
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

// ══════════════════════════════════════════════════
//  席位竞标（market.auction.* / market.selected / snapshot.market）
// ══════════════════════════════════════════════════

/** market.* 事件的 source 是 coordinator（后端 projectRunEventSource 只把 council.* 归到 council）。 */
const marketEvent = (type: string, payload: Record<string, unknown> = {}): RunEvent => ({
  ...event(type, payload),
  source: 'coordinator',
});

const scoreBreakdown = (finalScore: number) => ({
  relevance: 0.62,
  relevance_breakdown: { persona_match: 0.7, skill_match: 0.55, experience_match: 0.6 },
  quality: 0.74,
  quality_breakdown: {
    success_rate: 0.82,
    avg_confidence: 0.71,
    experience_density: 0.4,
    skill_density: 0.5,
  },
  capacity: 1,
  freshness: 0.9,
  bonus: 0.05,
  final_score: finalScore,
});

const auctionStarted = () =>
  marketEvent('market.auction.started', {
    auction_id: 'market_auction_1',
    selection_scope: 'council_seat',
    selection_mode: 'auction',
    seat: 'proposer',
    seat_index: 0,
    task_description: '写一个能跑的贪吃蛇网页',
    requirement_profile: {
      persona_keywords: ['贪吃蛇', '网页'],
      preferred_skill_tags: ['贪吃蛇', '网页'],
      preferred_experience_tags: ['贪吃蛇', '网页'],
    },
    candidates: [
      {
        role_id: 'agent_frontend',
        persona_ref: 'persona_frontend_v3',
        persona_keywords: ['html', 'canvas'],
        skills: [{ name: 'canvas 游戏循环', tags: ['html', 'game'] }],
        experiences: [
          { name: '贪吃蛇碰撞判定', type: 'positive', confidence: 0.82, tags: ['game'] },
        ],
        metrics: {
          total_tasks: 12,
          tasks_completed: 11,
          tasks_succeeded: 9,
          skill_count: 4,
          experience_count: 6,
          avg_confidence: 0.71,
        },
        load: { active_task_count: 0, days_since_last_task: 2 },
      },
      {
        role_id: 'agent_backend',
        persona_ref: 'persona_backend_v1',
        persona_keywords: ['node'],
        skills: [],
        experiences: [],
        metrics: {
          total_tasks: 3,
          tasks_completed: 2,
          tasks_succeeded: 1,
          skill_count: 1,
          experience_count: 0,
          avg_confidence: 0.4,
        },
        load: { active_task_count: 1, days_since_last_task: 19 },
      },
    ],
  });

const auctionCompleted = () =>
  marketEvent('market.auction.completed', {
    auction_id: 'market_auction_1',
    selection_scope: 'council_seat',
    selection_mode: 'auction',
    seat: 'proposer',
    seat_index: 0,
    policy_version: 'market-v0',
    seed: 'run-1:proposer:0',
    tau: 0.5,
    bids: [
      {
        bid_id: 'bid-back',
        role_id: 'agent_backend',
        final_score: 0.41,
        score_breakdown: scoreBreakdown(0.41),
        probability: 0.28,
        estimated_time_seconds: 900,
        strategy_summary: 'Backend agent bids conservatively.',
      },
      {
        bid_id: 'bid-front',
        role_id: 'agent_frontend',
        final_score: 0.78,
        score_breakdown: scoreBreakdown(0.78),
        probability: 0.72,
        estimated_time_seconds: 600,
        strategy_summary: 'Frontend agent has canvas experience.',
      },
    ],
    winner_role_id: 'agent_frontend',
    winner_bid_id: 'bid-front',
    winner_probability: 0.72,
    ledger_ref: 'artifact_ledger_1',
    audit_ref: 'artifact_audit_1',
  });

describe('councilBoard · 席位竞标', () => {
  it('started + completed 合并成一场竞标：候选人、按分降序的报价、赢家标记、打分明细', () => {
    const model = buildCouncilBoard([
      event('council.started', { trigger: 'explicit_mode' }),
      auctionStarted(),
      auctionCompleted(),
    ]);
    expect(model?.auctions).toHaveLength(1);
    const auction = model?.auctions[0];
    expect(auction?.auctionId).toBe('market_auction_1');
    expect(auction?.status).toBe('completed');
    expect(auction?.selectionScope).toBe('council_seat');
    expect(auction?.selectionMode).toBe('auction');
    expect(auction?.seat).toBe('proposer');
    expect(auction?.seatIndex).toBe(0);
    expect(auction?.tau).toBe(0.5);
    expect(auction?.policyVersion).toBe('market-v0');
    expect(auction?.ledgerRef).toBe('artifact_ledger_1');
    expect(auction?.auditRef).toBe('artifact_audit_1');

    // started 那半边：候选人与需求画像
    expect(auction?.candidates.map((c) => c.roleId)).toEqual(['agent_frontend', 'agent_backend']);
    expect(auction?.candidates[0].skills).toEqual([
      { name: 'canvas 游戏循环', tags: ['html', 'game'] },
    ]);
    expect(auction?.candidates[0].experiences[0].confidence).toBe(0.82);
    expect(auction?.candidates[0].metrics?.tasksSucceeded).toBe(9);
    expect(auction?.candidates[1].load?.daysSinceLastTask).toBe(19);
    expect(auction?.requirementProfile?.personaKeywords).toEqual(['贪吃蛇', '网页']);
    expect(auction?.taskDescription).toBe('写一个能跑的贪吃蛇网页');

    // completed 那半边：报价按 final_score 降序，赢家只有一个
    expect(auction?.bids.map((b) => b.bidId)).toEqual(['bid-front', 'bid-back']);
    expect(auction?.bids.map((b) => b.winner)).toEqual([true, false]);
    expect(auction?.winnerRoleId).toBe('agent_frontend');
    expect(auction?.winnerBidId).toBe('bid-front');
    expect(auction?.winnerProbability).toBe(0.72);
    expect(auction?.bids[0].score?.personaMatch).toBe(0.7);
    expect(auction?.bids[0].score?.successRate).toBe(0.82);
    expect(auction?.bids[0].score?.bonus).toBe(0.05);
    expect(auction?.bids[0].score?.finalScore).toBe(0.78);
    expect(auction?.bids[0].estimatedTimeSeconds).toBe(600);
  });

  it('只有 started（竞标还在跑）：status running，报价与赢家一律留空不虚构', () => {
    const model = buildCouncilBoard([event('council.started', {}), auctionStarted()]);
    const auction = model?.auctions[0];
    expect(auction?.status).toBe('running');
    expect(auction?.bids).toEqual([]);
    expect(auction?.winnerRoleId).toBe('');
    expect(auction?.winnerProbability).toBeNull();
    expect(auction?.tau).toBeNull();
    expect(auction?.candidates).toHaveLength(2);
  });

  it('缺 score_breakdown / final_score 的报价：score 为 null，排序时垫底而不是当 0 分', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      marketEvent('market.auction.completed', {
        auction_id: 'market_auction_2',
        selection_mode: 'auction',
        bids: [
          { bid_id: 'bid-none', role_id: 'agent_x', probability: 0 },
          { bid_id: 'bid-low', role_id: 'agent_y', final_score: 0.1, probability: 0.1 },
        ],
        winner_bid_id: 'bid-low',
        winner_role_id: 'agent_y',
      }),
    ]);
    const bids = model?.auctions[0].bids ?? [];
    expect(bids.map((b) => b.bidId)).toEqual(['bid-low', 'bid-none']);
    expect(bids[1].finalScore).toBeNull();
    expect(bids[1].score).toBeNull();
  });

  it('selection_mode 不是 auction 时 probabilitySampled 为 false（UI 据此隐藏概率）', () => {
    // 当前两个发射点都写死 'auction'，但 MarketEventContext.selection_mode 的联合里有 'fixed'，
    // 投影器原样透传 —— 前端不许假设它一定是 'auction'。
    const model = buildCouncilBoard([
      event('council.started', {}),
      marketEvent('market.auction.completed', {
        auction_id: 'market_auction_3',
        selection_scope: 'primary',
        selection_mode: 'fixed',
        bids: [{ bid_id: 'b1', role_id: 'agent_only', final_score: 1, probability: 0 }],
        winner_bid_id: 'b1',
        winner_role_id: 'agent_only',
        winner_probability: 0,
      }),
    ]);
    expect(model?.auctions[0].selectionMode).toBe('fixed');
    expect(model?.auctions[0].probabilitySampled).toBe(false);
    expect(model?.auctions[0].bids[0].winner).toBe(true);
  });

  it('快照 council.auctions[] 叠在事件之上（回放旧 run 时事件可能已经不在 timeline 里）', () => {
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
      auctions: [
        {
          auction_id: 'market_auction_1',
          status: 'completed',
          selection_scope: 'council_seat',
          selection_mode: 'auction',
          seat: 'synthesizer',
          seat_index: 0,
          winner_role_id: 'agent_frontend',
          winner_bid_id: 'bid-front',
          winner_probability: 0.66,
          ledger_ref: 'artifact_ledger_1',
          audit_ref: 'artifact_audit_1',
        },
      ],
    };
    const model = buildCouncilBoard([], council);
    expect(model?.auctions).toHaveLength(1);
    expect(model?.auctions[0].seat).toBe('synthesizer');
    expect(model?.auctions[0].winnerProbability).toBe(0.66);
  });

  it('老 run 只有 market.selected：primarySelection 撑出赢家，auctions 仍为空', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      marketEvent('market.selected', {
        selection_mode: 'fixed',
        winner_agent_id: 'agent_frontend',
        winner_bid_id: 'bid-front',
        ledger_ref: 'artifact_ledger_1',
        audit_ref: 'artifact_audit_1',
        policy_version: 'market-v0',
        seed: 'seed-1',
      }),
    ]);
    expect(model?.auctions).toEqual([]);
    expect(model?.primarySelection?.winnerAgentId).toBe('agent_frontend');
    expect(model?.primarySelection?.selectionMode).toBe('fixed');
    expect(model?.primarySelection?.auctionId).toBe('');
    expect(model?.primarySelection?.seed).toBe('seed-1');
  });

  it('只有 snapshot.market（事件已不在 timeline）：primarySelection 仍然成立', () => {
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
    };
    const model = buildCouncilBoard([], council, {
      winner_agent_id: 'agent_frontend',
      winner_bid_id: 'bid-front',
      ledger_ref: 'artifact_ledger_1',
      audit_ref: 'artifact_audit_1',
      policy_version: 'market-v0',
      seed: 'seed-1',
    });
    expect(model?.primarySelection?.winnerAgentId).toBe('agent_frontend');
    expect(model?.primarySelection?.ledgerRef).toBe('artifact_ledger_1');
    // 快照那半边没有这两个键，留空不编造
    expect(model?.primarySelection?.auctionId).toBe('');
    expect(model?.primarySelection?.selectionMode).toBe('');
  });

  it('没有任何选人证据 → primarySelection 为 null', () => {
    expect(buildCouncilBoard([event('council.started', {})])?.primarySelection).toBeNull();
  });

  it('只收到 started 的那场竞标：用同 auction_id 的 market.selected 补齐赢家（同源数据）', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      auctionStarted(),
      marketEvent('market.selected', {
        auction_id: 'market_auction_1',
        selection_mode: 'auction',
        winner_agent_id: 'agent_frontend',
        winner_bid_id: 'bid-front',
        ledger_ref: 'artifact_ledger_1',
        audit_ref: 'artifact_audit_1',
        policy_version: 'market-v0',
        seed: 'seed-1',
      }),
    ]);
    expect(model?.auctions[0].winnerRoleId).toBe('agent_frontend');
    expect(model?.auctions[0].winnerBidId).toBe('bid-front');
    // 补的只是赢家指纹，报价过程仍然没有 —— 不编造 bids
    expect(model?.auctions[0].bids).toEqual([]);
  });

  it('market.* 不进合议 feed，也不足以单独撑起面板', () => {
    expect(buildCouncilBoard([auctionStarted(), auctionCompleted()])).toBeNull();
    const model = buildCouncilBoard([event('council.started', {}), auctionStarted()]);
    expect(model?.feed.map((f) => f.type)).toEqual(['council.started']);
  });
});

// ══════════════════════════════════════════════════
//  席位名册 / 阶段
// ══════════════════════════════════════════════════

const participantsSelected = (selectionMode: string) =>
  event('council.participants.selected', {
    council_run_id: 'council_run_1',
    selection_mode: selectionMode,
    participants: [
      {
        participant_id: 'cp_p0_aaaa1111',
        seat: 'proposer',
        seat_index: 0,
        agent_id: 'agent_frontend',
        role_profile_ref: 'persona_frontend_v3',
        selection_refs: ['artifact_ledger_1', 'artifact_audit_1'],
      },
      {
        participant_id: 'cp_p1_bbbb2222',
        seat: 'proposer',
        seat_index: 1,
        agent_id: 'agent_backend',
      },
      {
        participant_id: 'cp_r0_cccc3333',
        seat: 'reviewer',
        seat_index: 0,
        agent_id: 'agent_frontend',
        conflict_flags: ['agent_reused_across_council_seats'],
      },
      {
        participant_id: 'cp_s0_dddd4444',
        seat: 'synthesizer',
        seat_index: 0,
        agent_id: 'agent_reviewer',
      },
    ],
  });

describe('councilBoard · 席位名册', () => {
  it('council.participants.selected → 席位、身份、竞标凭证、冲突标记，外加 selection_mode', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      participantsSelected('auction'),
    ]);
    expect(model?.participantSelectionMode).toBe('auction');
    expect(model?.councilRunId).toBe('council_run_1');
    expect(model?.participants).toHaveLength(4);
    expect(model?.participants.map((p) => p.seat)).toEqual([
      'proposer',
      'proposer',
      'reviewer',
      'synthesizer',
    ]);
    expect(model?.participants[0].participantId).toBe('cp_p0_aaaa1111');
    expect(model?.participants[0].agentId).toBe('agent_frontend');
    expect(model?.participants[0].roleProfileRef).toBe('persona_frontend_v3');
    expect(model?.participants[0].selectionRefs).toEqual(['artifact_ledger_1', 'artifact_audit_1']);
    expect(model?.participants[1].selectionRefs).toEqual([]);
    expect(model?.participants[2].conflictFlags).toEqual(['agent_reused_across_council_seats']);
    expect(model?.participants[3].seatIndex).toBe(0);
  });

  it('selection_mode 是 fixed / board_order 时原样透出（这两种压根没跑竞标）', () => {
    expect(
      buildCouncilBoard([event('council.started', {}), participantsSelected('fixed')])
        ?.participantSelectionMode,
    ).toBe('fixed');
    expect(
      buildCouncilBoard([event('council.started', {}), participantsSelected('board_order')])
        ?.participantSelectionMode,
    ).toBe('board_order');
  });

  it('快照 participants 优先于事件（投影器已经挑过 council.completed 那一份）', () => {
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
      participants: [
        {
          participant_id: 'cp_s0_final',
          seat: 'synthesizer',
          council_seat: 'synthesizer',
          seat_index: 0,
          agent_id: 'agent_final',
        },
      ],
    };
    const model = buildCouncilBoard(
      [event('council.started', {}), participantsSelected('auction')],
      council,
    );
    expect(model?.participants.map((p) => p.participantId)).toEqual(['cp_s0_final']);
    // selection_mode 只有事件才带，快照里没有这个字段
    expect(model?.participantSelectionMode).toBe('auction');
  });
});

describe('councilBoard · 阶段', () => {
  const phaseEvents = () => [
    event('council.started', { trigger: 'agent_request' }),
    participantsSelected('auction'),
    event('council.phase.started', {
      council_run_id: 'council_run_1',
      phase_id: 'council_phase_1',
      phase: 'proposal',
      attempt: 1,
      participant_id: 'cp_p0_aaaa1111',
      seat: 'proposer',
      council_seat: 'proposer',
      seat_index: 0,
      agent_id: 'agent_frontend',
      input_artifact_refs: ['artifact_1'],
    }),
    event('council.phase.started', {
      council_run_id: 'council_run_1',
      phase_id: 'council_phase_2',
      phase: 'synthesis',
      attempt: 2,
      participant_id: 'cp_s0_dddd4444',
      seat: 'synthesizer',
      council_seat: 'synthesizer',
      seat_index: 0,
      agent_id: 'agent_reviewer',
      input_artifact_refs: ['artifact_1', 'artifact_2'],
    }),
  ];

  it('每条 council.phase.started 进历史，最后一条就是「谁正在做什么」', () => {
    const model = buildCouncilBoard(phaseEvents());
    expect(model?.phases.map((p) => p.phase)).toEqual(['proposal', 'synthesis']);
    expect(model?.activePhase?.phaseId).toBe('council_phase_2');
    expect(model?.activePhase?.phase).toBe('synthesis');
    expect(model?.activePhase?.attempt).toBe(2);
    expect(model?.activePhase?.seat).toBe('synthesizer');
    expect(model?.activePhase?.agentId).toBe('agent_reviewer');
    expect(model?.activePhase?.inputArtifactRefs).toEqual(['artifact_1', 'artifact_2']);
    // provider 变体没有 role_id / session_id —— 留空，不拿 agent_id 顶上
    expect(model?.activePhase?.roleId).toBe('');
    expect(model?.activePhase?.sessionId).toBe('');
    expect(model?.phase).toBe('synthesis');
  });

  it('coordinator 发的 implementation 变体：带 role_id / session_id，没有席位信息', () => {
    const model = buildCouncilBoard([
      ...phaseEvents(),
      event('council.phase.started', {
        council_run_id: 'council_run_1',
        phase_id: 'council_phase_3',
        phase: 'implementation',
        attempt: 1,
        role_id: 'agent_frontend',
        agent_id: 'agent_frontend',
        session_id: 'sess_impl',
        input_artifact_refs: ['artifact_plan_1'],
      }),
    ]);
    expect(model?.activePhase?.phase).toBe('implementation');
    expect(model?.activePhase?.roleId).toBe('agent_frontend');
    expect(model?.activePhase?.sessionId).toBe('sess_impl');
    expect(model?.activePhase?.participantId).toBe('');
    expect(model?.activePhase?.seat).toBe('');
    expect(model?.phase).toBe('implementation');
  });

  it('phase 走后端投影器的倒扫规则；快照带 phase 就以快照为准', () => {
    expect(buildCouncilBoard([event('council.started', {})])?.phase).toBe('selecting');
    expect(buildCouncilBoard(liveEvents())?.phase).toBe('review');
    expect(
      buildCouncilBoard([...liveEvents(), event('council.decision', { verdict: 'select' })])?.phase,
    ).toBe('decision');
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      phase: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
    };
    expect(buildCouncilBoard(liveEvents(), council)?.phase).toBe('completed');
  });
});

// ══════════════════════════════════════════════════
//  议题 / 策略 / 实施 / 失败 / 终态证据
// ══════════════════════════════════════════════════

describe('councilBoard · 议题与策略', () => {
  it('council.started 回显议题、策略与产物形态；快照优先', () => {
    const started = event('council.started', {
      trigger: 'explicit_mode',
      subject: '写一个能跑的贪吃蛇网页',
      decision_mode: 'advisory',
      artifact_mode: 'plan',
      primary_role_id: 'agent_frontend',
      candidate_artifact_refs: ['artifact_1'],
      strategy: 'plan_first',
    });
    const fromEvents = buildCouncilBoard([started]);
    expect(fromEvents?.subject).toBe('写一个能跑的贪吃蛇网页');
    expect(fromEvents?.strategy).toBe('plan_first');
    expect(fromEvents?.artifactMode).toBe('plan');
    expect(fromEvents?.trigger).toBe('explicit_mode');

    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      council_run_id: 'council_run_1',
      subject: '写一个能跑的贪吃蛇网页',
      strategy: 'plan_first',
      artifact_mode: 'plan',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
    };
    const fromSnapshot = buildCouncilBoard([], council);
    expect(fromSnapshot?.subject).toBe('写一个能跑的贪吃蛇网页');
    expect(fromSnapshot?.councilRunId).toBe('council_run_1');
    expect(fromSnapshot?.artifactMode).toBe('plan');
  });

  it('后端没发就留空：没有 council.started 时议题/策略/产物形态都是空串', () => {
    const model = buildCouncilBoard([event('council.decision', { verdict: 'select' })]);
    expect(model?.subject).toBe('');
    expect(model?.strategy).toBe('');
    expect(model?.artifactMode).toBe('');
    expect(model?.councilRunId).toBe('');
  });
});

describe('councilBoard · 实施段（plan_first）', () => {
  const implementationEvent = () =>
    event('council.implementation.completed', {
      council_run_id: 'council_run_1',
      phase_id: 'council_phase_3',
      phase: 'implementation',
      executor_role_id: 'agent_frontend',
      agent_id: 'agent_frontend',
      session_id: 'sess_impl',
      agent_run_id: 'agent_run_11',
      driver_run_result_id: 'drr_11',
      final_plan_artifact_refs: ['artifact_plan_1'],
      implementation_artifact_refs: ['artifact_impl_1', 'artifact_impl_2'],
      response: '已经按最终 Plan 写完 snake.html。',
    });

  /** 投影器优先用 council.completed 的 plan_execution —— 只有 6 个字段，没有 response。 */
  const planExecutionSnapshot = (): NonNullable<RunSnapshot['council']> => ({
    enabled: true,
    status: 'completed',
    selected_artifact_refs: ['artifact_impl_1'],
    required_next_actions: [],
    blocked_by: [],
    can_create_merge_authorization: false,
    implementation: {
      executor_role_id: 'agent_frontend',
      session_id: 'sess_impl',
      agent_run_id: 'agent_run_11',
      driver_run_result_id: 'drr_11',
      final_plan_artifact_refs: ['artifact_plan_1'],
      implementation_artifact_refs: ['artifact_impl_1', 'artifact_impl_2'],
    },
  });

  it('只有事件：executor / 会话 / 运行引用 / 两组制品 / 回复正文全在', () => {
    const model = buildCouncilBoard([event('council.started', {}), implementationEvent()]);
    expect(model?.implementation?.councilRunId).toBe('council_run_1');
    expect(model?.implementation?.phaseId).toBe('council_phase_3');
    expect(model?.implementation?.executorRoleId).toBe('agent_frontend');
    expect(model?.implementation?.sessionId).toBe('sess_impl');
    expect(model?.implementation?.agentRunId).toBe('agent_run_11');
    expect(model?.implementation?.driverRunResultId).toBe('drr_11');
    expect(model?.implementation?.finalPlanArtifactRefs).toEqual(['artifact_plan_1']);
    expect(model?.implementation?.implementationArtifactRefs).toEqual([
      'artifact_impl_1',
      'artifact_impl_2',
    ]);
    expect(model?.implementation?.response).toBe('已经按最终 Plan 写完 snake.html。');
  });

  it('只有快照（plan_execution 那 6 个字段）：缺的键留空，不编造 response', () => {
    const model = buildCouncilBoard([], planExecutionSnapshot());
    expect(model?.implementation?.executorRoleId).toBe('agent_frontend');
    expect(model?.implementation?.implementationArtifactRefs).toHaveLength(2);
    expect(model?.implementation?.response).toBe('');
    expect(model?.implementation?.councilRunId).toBe('');
    expect(model?.implementation?.phaseId).toBe('');
  });

  it('两边都有：快照打底，事件补上 response / phase_id / council_run_id', () => {
    const model = buildCouncilBoard(
      [event('council.started', {}), implementationEvent()],
      planExecutionSnapshot(),
    );
    expect(model?.implementation?.response).toBe('已经按最终 Plan 写完 snake.html。');
    expect(model?.implementation?.phaseId).toBe('council_phase_3');
    expect(model?.implementation?.councilRunId).toBe('council_run_1');
    expect(model?.implementation?.agentId).toBe('agent_frontend');
  });

  it('非 plan_first：没有实施段 → null', () => {
    expect(buildCouncilBoard(liveEvents())?.implementation).toBeNull();
  });
});

describe('councilBoard · 单席位失败不是合议终态', () => {
  const roleFailed = () =>
    event('council.role.failed', {
      code: 'COUNCIL_REVIEW_FAILED',
      phase: 'council',
      council_phase: 'review',
      participant_id: 'cp_r0_cccc3333',
      seat: 'reviewer',
      council_seat: 'reviewer',
      seat_index: 0,
      agent_id: 'agent_reviewer',
      agent_status: 'failed',
      agent_run_id: 'agent_run_9',
      driver_run_result_id: 'drr_9',
      failure_details: {
        dispatch_status: 'failed',
        driver_error_code: 'B_BLOCKED',
        driver_error_message: 'driver refused the prompt',
        retryable: true,
        council_run_id: 'council_run_1',
        phase_id: 'council_phase_2',
      },
      fallback_action: 'continue_with_available_evidence',
    });

  it('council.role.failed 只进告警列表，status 不翻 failed，failedCode 不被污染', () => {
    const model = buildCouncilBoard([event('council.started', {}), roleFailed()]);
    expect(model?.status).toBe('running');
    expect(model?.failedCode).toBe('');
    expect(model?.fatalError).toBeNull();
    expect(model?.roleFailures).toHaveLength(1);
    const failure = model?.roleFailures[0];
    expect(failure?.code).toBe('COUNCIL_REVIEW_FAILED');
    expect(failure?.councilPhase).toBe('review');
    expect(failure?.participantId).toBe('cp_r0_cccc3333');
    expect(failure?.seat).toBe('reviewer');
    expect(failure?.agentId).toBe('agent_reviewer');
    expect(failure?.agentStatus).toBe('failed');
    expect(failure?.agentRunId).toBe('agent_run_9');
    expect(failure?.driverErrorCode).toBe('B_BLOCKED');
    expect(failure?.errorMessage).toBe('driver refused the prompt');
    expect(failure?.fallbackAction).toBe('continue_with_available_evidence');
  });

  it('缺席位照样跑完：role.failed 之后 council.completed 仍然是 completed', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      roleFailed(),
      event('council.decision', { verdict: 'select' }),
      event('council.completed', { decision_id: 'dec-1', selected_artifact_refs: ['artifact-9'] }),
    ]);
    expect(model?.status).toBe('completed');
    expect(model?.phase).toBe('completed');
    expect(model?.roleFailures).toHaveLength(1);
  });

  it('抛错路径的 failure_details 只有 error_message：errorMessage 取它，driverErrorCode 留空', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      event('council.role.failed', {
        code: 'COUNCIL_PROPOSAL_FAILED',
        phase: 'council',
        council_phase: 'proposal',
        participant_id: 'cp_p1_bbbb2222',
        seat: 'proposer',
        council_seat: 'proposer',
        seat_index: 1,
        agent_id: 'agent_backend',
        agent_status: 'failed',
        failure_details: {
          error_name: 'Error',
          error_message: 'Council plan artifact assertion failed',
          council_run_id: 'council_run_1',
        },
        fallback_action: 'continue_with_available_evidence',
      }),
    ]);
    expect(model?.roleFailures[0].errorMessage).toBe('Council plan artifact assertion failed');
    expect(model?.roleFailures[0].driverErrorCode).toBe('');
    expect(model?.roleFailures[0].agentRunId).toBe('');
  });
});

describe('councilBoard · 致命错误与终态证据', () => {
  it('council.failed 事件 → fatalError（code / message / fatal）+ status failed', () => {
    const model = buildCouncilBoard([
      event('council.started', {}),
      event('council.failed', {
        code: 'COUNCIL_NO_SELECTED_ARTIFACT',
        message: 'Council produced no selected artifact',
        fatal: true,
      }),
    ]);
    expect(model?.status).toBe('failed');
    expect(model?.phase).toBe('failed');
    expect(model?.fatalError).toEqual({
      code: 'COUNCIL_NO_SELECTED_ARTIFACT',
      message: 'Council produced no selected artifact',
      fatal: true,
    });
    expect(model?.failedCode).toBe('COUNCIL_NO_SELECTED_ARTIFACT');
  });

  it('快照 fatal_error（事件已不在 timeline）同样撑起 fatalError', () => {
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'failed',
      phase: 'failed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
      fatal_error: {
        code: 'COUNCIL_IMPLEMENTATION_FAILED',
        message: 'Primary Agent Plan execution ended with status failed',
        fatal: true,
      },
    };
    const model = buildCouncilBoard([], council);
    expect(model?.failedCode).toBe('COUNCIL_IMPLEMENTATION_FAILED');
    expect(model?.fatalError?.message).toBe(
      'Primary Agent Plan execution ended with status failed',
    );
  });

  it('result 与 outcome 从快照透出；outcome 保持后端 DTO 原形', () => {
    const council: NonNullable<RunSnapshot['council']> = {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: ['artifact-9'],
      required_next_actions: ['post_council_gate'],
      blocked_by: [],
      can_create_merge_authorization: false,
      result: {
        quality: 'best_effort',
        final_artifact_ref: 'artifact-9',
        final_artifact_sha256: 'a'.repeat(64),
        warnings: ['Council quality attestation is not available yet.'],
        unmet_criteria: [],
        verification_refs: [],
        decision_record_ref: 'dec-1',
      },
      outcome: {
        status: 'completed',
        participant_role_ids: ['agent_frontend', 'agent_backend'],
        selected_artifact_refs: ['artifact-9'],
        decision_summary: 'Synthesized final candidate.',
        quality: 'best_effort',
        unresolved_issues: [],
        warnings: ['Council quality attestation is not available yet.'],
        audit_refs: ['artifact_audit_1'],
      },
    };
    const model = buildCouncilBoard([], council);
    expect(model?.result?.quality).toBe('best_effort');
    expect(model?.result?.finalArtifactRef).toBe('artifact-9');
    expect(model?.result?.warnings).toEqual(['Council quality attestation is not available yet.']);
    expect(model?.result?.decisionRecordRef).toBe('dec-1');
    expect(model?.outcome?.status).toBe('completed');
    expect(model?.outcome?.participant_role_ids).toEqual(['agent_frontend', 'agent_backend']);
    expect(model?.outcome?.audit_refs).toEqual(['artifact_audit_1']);
    expect(model?.requiredNextActions).toEqual(['post_council_gate']);
  });

  it('快照没有 result / outcome 时是 null，不给空壳', () => {
    const model = buildCouncilBoard(liveEvents());
    expect(model?.result).toBeNull();
    expect(model?.outcome).toBeNull();
    expect(model?.fatalError).toBeNull();
    expect(model?.roleFailures).toEqual([]);
    expect(model?.participants).toEqual([]);
    expect(model?.phases).toEqual([]);
    expect(model?.activePhase).toBeNull();
    expect(model?.auctions).toEqual([]);
  });
});

describe('councilBoard · 交付信封 council.output', () => {
  /** 形状照抄一次真实 council run 的 `snapshot.council.output`（2026-08-24 实跑）。 */
  const outputSnapshot = (): NonNullable<RunSnapshot['council']> =>
    ({
      enabled: true,
      status: 'completed',
      selected_artifact_refs: ['artifact-final'],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
      output: {
        output_id: 'council_output_1',
        status: 'selected',
        decision_ref: 'council_decision_1',
        selected_artifact_refs: ['artifact-final'],
        can_create_merge_authorization: false,
        generated_artifact_refs: [
          {
            artifact_id: 'artifact-p0',
            type: 'patch',
            uri: 'artifact://workspace-file/task-1/hello.txt',
            sha256: 'sha-p0',
            producer_id: 'claude',
            metadata: { source: 'workspace-change', workspace_path: '/ws/council/run/cp_p0_aaaa' },
            content: { kind: 'file', target_path: 'hello.txt', media_type: 'text/plain' },
            created_at: '2026-08-24T13:21:42.278Z',
          },
          {
            artifact_id: 'artifact-p1',
            type: 'patch',
            uri: 'artifact://workspace-file/task-1/hello.txt',
            sha256: 'sha-p1',
            producer_id: 'claude',
            metadata: { source: 'workspace-change', workspace_path: '/ws/council/run/cp_p1_bbbb' },
            content: { kind: 'file', target_path: 'hello.txt', media_type: 'text/plain' },
            created_at: '2026-08-24T13:22:34.383Z',
          },
        ],
      },
    }) as unknown as NonNullable<RunSnapshot['council']>;

  it('解析出交付 ID、状态与每个席位各自的产出', () => {
    const model = buildCouncilBoard([], outputSnapshot());
    expect(model?.output?.outputId).toBe('council_output_1');
    expect(model?.output?.status).toBe('selected');
    expect(model?.output?.decisionRef).toBe('council_decision_1');
    expect(model?.output?.canCreateMergeAuthorization).toBe(false);
    expect(model?.output?.generatedArtifacts).toHaveLength(2);
  });

  it('同一路径的多份产出各自带上席位来源 —— 这是「谁改了同一个文件」的唯一线索', () => {
    const model = buildCouncilBoard([], outputSnapshot());
    const artifacts = model?.output?.generatedArtifacts ?? [];
    expect(artifacts.map((a) => a.targetPath)).toEqual(['hello.txt', 'hello.txt']);
    // producer_id 是 driver 名（claude），对不上席位；席位只能从 workspace_path 尾部取
    expect(artifacts.map((a) => a.source)).toEqual(['cp_p0_aaaa', 'cp_p1_bbbb']);
    expect(artifacts.map((a) => a.mediaType)).toEqual(['text/plain', 'text/plain']);
  });

  it('后端没给 output 时为 null，不虚构空信封', () => {
    const model = buildCouncilBoard([], {
      enabled: true,
      status: 'completed',
      selected_artifact_refs: [],
      required_next_actions: [],
      blocked_by: [],
      can_create_merge_authorization: false,
    } as unknown as NonNullable<RunSnapshot['council']>);
    expect(model?.output).toBeNull();
  });

  it('targetPath 缺失时退回 uri，不留空串', () => {
    const snapshot = outputSnapshot();
    const refs = (snapshot.output as { generated_artifact_refs: Record<string, unknown>[] })
      .generated_artifact_refs;
    refs[0] = { ...refs[0], content: { kind: 'file' }, metadata: {} };
    const model = buildCouncilBoard([], snapshot);
    expect(model?.output?.generatedArtifacts[0].targetPath).toBe(
      'artifact://workspace-file/task-1/hello.txt',
    );
    expect(model?.output?.generatedArtifacts[0].source).toBe('');
  });
});

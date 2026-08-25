/**
 * 方向 C · Council API 类型。
 *
 * 本文件分三层：
 *  1) 【v0 后端契约·已实现】对齐 BCD `src/council/contract.ts`（newide-scaffold 已落地）。
 *  2) 【Run 快照子结构·投影器定义】Run 快照里 council / market 那几块嵌套记录的真实字段名。
 *     它们在后端 zod 里只是 `z.record(z.string(), z.unknown())`，形状由投影器和事件发射点决定，
 *     不受 schema 约束 —— 详见该节开头的说明。
 *  3) 【后端规划中·前端保留】更丰富的评审/决策类型 —— Council RFC 已定义，且 BCD
 *     `hook` 已列出 council.context_packaged / profile_snapshot_saved / diff_ready /
 *     decision 等点位，属后端打算实现但 v0 尚未落地的部分。依"后端打算实现则前端
 *     保留"的原则保留；在后端落地前，不要假设当前 v0 会返回这些字段。
 */

import type { AgentId, ArtifactId, RoleId, RunId, SchemaVersion, TaskId, Timestamp } from './core';
import type { RiskLevel } from './coord';

// ══════════════════════════════════════════════════
//  1) v0 后端契约（council/contract.ts）
// ══════════════════════════════════════════════════

export interface Proposal {
  proposal_id: string;
  run_id: RunId;
  task_id: TaskId;
  artifact_refs: ArtifactId[];
  summary: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/**
 * 评审结论。与 `packages/newide-bcd/src/council/contract.ts` 的 Review 逐字对齐。
 * 单独命名是为了让 UI 词表能锚在它上面 —— 后端改词表，前端编译期就红。
 */
export type ReviewVerdict = 'approve' | 'reject' | 'needs_revision';

export interface Review {
  review_id: string;
  proposal_id: string;
  reviewer_id: string;
  verdict: ReviewVerdict;
  reason: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface EvidencePack {
  evidence_pack_id: string;
  context_pack_ref: string;
  artifact_refs: ArtifactId[];
  gate_result_refs: string[];
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/**
 * 合议裁决取值。与 `packages/newide-bcd/src/council/contract.ts` 的 CouncilDecision 逐字对齐。
 *
 * 曾经写作 `'accept' | 'reject' | 'defer'` —— 后端从来没发过这三个值中的任何一个；
 * 2026-07-20 实跑一条 council run 抓到的真实取值是 `select`，压根不在旧联合里。
 * 单独命名是为了让 RPC 快照字段与 UI 词表锚在**同一个**类型上，两端一起动。
 */
export type CouncilVerdict = 'select' | 'needs_human' | 'request_revision' | 'reject';

export type CouncilOutcomeStatus = 'completed' | 'needs_human' | 'failed';

/** Stable Council result envelope exposed by Run and Task snapshots. */
export interface CouncilOutcome {
  status: CouncilOutcomeStatus;
  participant_role_ids: string[];
  selected_artifact_refs: ArtifactId[];
  decision_summary: string;
  quality: 'verified' | 'best_effort';
  unresolved_issues: string[];
  warnings: string[];
  audit_refs: string[];
}

export interface CouncilPlanExecution {
  executor_role_id: string;
  session_id: string;
  agent_run_id: string;
  driver_run_result_id: string;
  final_plan_artifact_refs: ArtifactId[];
  implementation_artifact_refs: ArtifactId[];
}

/** v0 权威决策形状（council/contract.ts）。前端前瞻的富形状见下方 `DecisionPacket`。 */
export interface CouncilDecision {
  decision_id: string;
  run_id: RunId;
  task_id: TaskId;
  selected_proposal_id?: string;
  verdict: CouncilVerdict;
  reason: string;
  evidence_refs: string[];
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface CouncilRoundInput {
  run_id: RunId;
  task_id: TaskId;
  proposals: Proposal[];
  reviews?: Review[];
  evidence_pack: EvidencePack;
}

// ══════════════════════════════════════════════════
//  2) Run 快照里的 Council / Market 子结构（projector 定义，schema 未固定）
// ══════════════════════════════════════════════════

/**
 * ⚠️ 本节所有形状**都不是 zod 保证的**。
 *
 * `protocol/run-snapshot.ts` 里 `auctions` / `participants` / `proposals` / `reviews` /
 * `synthesis` / `implementation` / `fatal_error` 一律声明成 `z.record(z.string(), z.unknown())`，
 * schema 只保证「是个对象」。真正决定字段名的是投影器 `app/task-run-snapshot-projector.ts`
 * 和各个事件发射点（`app/market-event-payload.ts`、`app/production-stage-executors.ts`、
 * `council/providers/synthesis-agent-provider.ts`）。
 *
 * 所以下面这些接口是「后端当前会发什么」的声明，不是运行时保证：消费方仍然要用
 * `lib/councilBoard.ts` 里的 asRecord / str / strList 逐字段防御性取值，
 * 不要把整块 `Record<string, unknown>` 直接 as 成这里的接口。
 */

/** Run 快照 `council.phase`。8 个取值逐字对齐 run-snapshot.ts 的 z.enum。 */
export type CouncilPhase =
  | 'selecting'
  | 'proposal'
  | 'review'
  | 'synthesis'
  | 'implementation'
  | 'decision'
  | 'completed'
  | 'failed';

/** Council 席位。对齐 `council/council-participant.ts` 的 CouncilSeat。 */
export type CouncilSeat = 'proposer' | 'reviewer' | 'synthesizer';

/** 这场竞标在选谁：主执行席位，还是某个 Council 席位。 */
export type MarketSelectionScope = 'primary' | 'council_seat';

/**
 * `market.auction.*` 事件里的选择方式 —— 只有两个取值。
 * 别和下面 `CouncilParticipantSelectionMode` 混用，那个多两个值。
 */
export type MarketSelectionMode = 'auction' | 'fixed';

/**
 * `council.participants.selected` 的 selection_mode。
 * 'explicit' = 调用方直接指定了席位；'fixed' = 配置了 NEWIDE_COUNCIL_SEATS；
 * 'auction' = 逐席位竞标；'board_order' = 按 AgentBoard 顺序兜底分配。
 */
export type CouncilParticipantSelectionMode = 'explicit' | 'fixed' | 'auction' | 'board_order';

export interface MarketCandidateSkill {
  name: string;
  tags: string[];
}

export interface MarketCandidateExperience {
  name: string;
  type: 'positive' | 'negative';
  confidence: number;
  tags: string[];
}

export interface MarketCandidateMetrics {
  total_tasks: number;
  tasks_completed: number;
  tasks_succeeded: number;
  skill_count: number;
  experience_count: number;
  avg_confidence: number;
}

export interface MarketCandidateLoad {
  active_task_count: number;
  days_since_last_task: number;
}

/**
 * 竞标候选人。注意后端在投影时改过名：AgentProjection 的
 * `agent_id` → `role_id`、`metrics_ref` → `metrics`、`load_state` → `load`。
 * 列表都被截断过（persona_keywords / skills 各 12 条，experiences 8 条，tags 8 条），
 * 所以这里的数组不是 Agent 的全量画像。
 */
export interface MarketAuctionCandidate {
  role_id: RoleId;
  persona_ref: string;
  persona_keywords: string[];
  skills: MarketCandidateSkill[];
  experiences: MarketCandidateExperience[];
  metrics: MarketCandidateMetrics;
  load: MarketCandidateLoad;
}

/** 竞标需求画像。三个数组当前来自同一份任务描述关键词，内容常常重复。 */
export interface MarketRequirementProfile {
  persona_keywords: string[];
  preferred_skill_tags: string[];
  preferred_experience_tags: string[];
}

export interface MarketRelevanceBreakdown {
  persona_match: number;
  skill_match: number;
  experience_match: number;
}

export interface MarketQualityBreakdown {
  success_rate: number;
  avg_confidence: number;
  experience_density: number;
  skill_density: number;
}

/** 打分明细。除 `bonus`（0..0.15）外各项都在 0..1。 */
export interface MarketScoreBreakdown {
  relevance: number;
  relevance_breakdown: MarketRelevanceBreakdown;
  quality: number;
  quality_breakdown: MarketQualityBreakdown;
  capacity: number;
  freshness: number;
  bonus: number;
  final_score: number;
}

/**
 * 一份报价。这是 Bid 的投影，不是原始 Bid ——
 * `task_id` / `created_at` / `schema_version` 被丢掉，`agent_id` 改名 `role_id`，
 * `probability` 是从 MarketAudit.probabilities 里按 bid_id 拼进来的。
 */
export interface MarketAuctionBid {
  bid_id: string;
  role_id: RoleId;
  final_score: number;
  score_breakdown: MarketScoreBreakdown;
  /** 见 `CouncilAuction` 上关于 probability 的说明。缺失时后端补 0。 */
  probability: number;
  estimated_time_seconds: number;
  strategy_summary: string;
}

/** 投影器注入的字段：最后一条事件是 `.completed` 才算 completed。 */
export type CouncilAuctionStatus = 'running' | 'completed';

/**
 * Run 快照 `council.auctions[]` 的一项。
 *
 * 它是 `market.auction.started` 与 `market.auction.completed` 两条事件按 `auction_id`
 * 合并出来的（completed 后铺，同名键覆盖 started），再补一个 `status`。因此
 * `candidates` 来自 started 那半边，`bids` / `winner_*` / `tau` 来自 completed 那半边；
 * 竞标还在跑时只有前半边，所以除 `auction_id` / `status` 外全部按可选读。
 *
 * ⚠️ 只有 `run.mode === 'council'` 的快照才会投影这个字段；单 agent 跑的主席位竞标
 * 只出现在 timeline 里，快照的任何结构化字段都看不到它。
 *
 * ⚠️ `probability` / `winner_probability` 只是**这一场**竞标里 seeded-softmax 的抽样概率
 * （来自 MarketAudit.probabilities，取不到就是 0），不是「这个 agent 有多强」的通用评分，
 * 也不能跨场比较。`selection_mode` 是 fixed 或 board_order 时压根没跑 softmax，
 * 此时不要展示 probability / winner_probability —— 展示出来就是编造。
 */
export interface CouncilAuction {
  auction_id: string;
  status: CouncilAuctionStatus;
  selection_scope?: MarketSelectionScope;
  selection_mode?: MarketSelectionMode;
  /** 只有 `selection_scope === 'council_seat'` 才带。 */
  seat?: CouncilSeat;
  /** 只有 `selection_scope === 'council_seat'` 才带。 */
  seat_index?: number;
  task_description?: string;
  requirement_profile?: MarketRequirementProfile;
  candidates?: MarketAuctionCandidate[];
  policy_version?: string;
  seed?: string;
  /** seeded-softmax 温度，0.3..1。 */
  tau?: number;
  bids?: MarketAuctionBid[];
  winner_role_id?: RoleId;
  winner_bid_id?: string;
  winner_probability?: number;
  ledger_ref?: string;
  audit_ref?: string;
}

/**
 * Council 席位与真实 Agent 的绑定，即 Run 快照 `council.participants[]` 的一项。
 *
 * 两个来源的字段不完全一致：
 *  - `council.participants.selected` 发的是**裸** CouncilParticipantBinding，没有 `council_seat`；
 *  - 其余 council.* 事件走 participantAuditPayload，会多一个与 `seat` 同值的 `council_seat`。
 * 投影器优先取 `council.completed` 的 participants，取不到才回落到 participants.selected。
 */
export interface CouncilParticipant {
  /** 形如 cp_<p|r|s><seat_index>_<8 位十六进制>，本轮实例 id，不是 Agent id。 */
  participant_id: string;
  seat: CouncilSeat;
  /** 与 `seat` 同值的审计副本，只有 participantAuditPayload 那条路径带它。 */
  council_seat?: CouncilSeat;
  seat_index: number;
  /** 指向 B 仓库里真实持久化的 Agent。 */
  agent_id: AgentId;
  role_profile_ref?: string;
  /** 竞标出来的席位带 [ledger_ref, audit_ref]，其余席位不带这个键。 */
  selection_refs?: string[];
  /** 已见取值：'agent_reused_across_council_seats' / 'best_effort_identity'。 */
  conflict_flags?: string[];
}

/**
 * Run 快照 `council.implementation` —— plan_first 策略下，主 Agent 按最终 Plan 实施的那一段。
 * 非 plan_first 的 Council 不会有这个字段。
 *
 * 投影器先取 `council.completed` 的 `plan_execution`（就是 CouncilPlanExecution 那 6 个字段），
 * 取不到才把整条 `council.implementation.completed` 的 payload 塞进来 ——
 * 后者才带 council_run_id / phase_id / phase / agent_id / response，所以这 5 个是可选的。
 */
export interface CouncilImplementation extends CouncilPlanExecution {
  council_run_id?: string;
  phase_id?: string;
  phase?: 'implementation';
  agent_id?: AgentId;
  /** 实施 Agent 的完整回复正文，可能很长。 */
  response?: string;
}

/** `council.failed` 目前只有这四个 code（全是发射点写死的字面量）。 */
export type CouncilFatalErrorCode =
  | 'COUNCIL_EXECUTION_FAILED'
  | 'COUNCIL_NO_SELECTED_ARTIFACT'
  | 'COUNCIL_RESULT_MISSING'
  | 'COUNCIL_IMPLEMENTATION_FAILED';

/**
 * Run 快照 `council.fatal_error` —— 整条 `council.failed` 事件 payload 的拷贝。
 * 出现它就意味着 Council 阶段抛异常终止了，`council.phase` 同时会是 'failed'。
 */
export interface CouncilFatalError {
  /**
   * 已知取值见 `CouncilFatalErrorCode`。后端 emitCouncilFailure 的形参类型是裸 string，
   * 不是编译期枚举，所以 UI 词表要留兜底，别做穷尽 switch。
   */
  code: string;
  message: string;
  /** 后端两个发射点都写死 true。 */
  fatal: boolean;
}

/**
 * Run 快照 `market` —— 主执行席位的选人结果指纹（来自 `market.selected`）。
 *
 * schema 是 .strict() 且 6 个字段全必填；投影器只要有一个取不到就把整块丢掉，
 * 所以它要么 6 个字段齐全，要么整个对象不存在，不存在"半块"。
 * 它只记录结果，不含竞标过程 —— 过程在 `council.auctions` 里，且只有 council 模式才投影。
 */
export interface RunMarketSelection {
  winner_agent_id: AgentId;
  winner_bid_id: string;
  ledger_ref: string;
  audit_ref: string;
  policy_version: string;
  seed: string;
}

// ══════════════════════════════════════════════════
//  3) 后端规划中·前端保留（Council RFC；BCD v0 尚未落地）
// ══════════════════════════════════════════════════

export type CouncilStatus =
  | 'created'
  | 'context_packaging'
  | 'profile_snapshotting'
  | 'extracting'
  | 'proposing'
  | 'cross_reviewing'
  | 'diffing'
  | 'judging'
  | 'deciding'
  | 'completed'
  | 'escalated_to_human'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export type CouncilParticipantProfileSnapshot = {
  participant_id: string;
  council_id: string;
  agent_id: string;
  role_id: string;
  driver_id: string;
  participant_role: 'proposer' | 'reviewer' | 'judge' | 'observer';
  capability_tags: string[];
  domain_experience_summary?: string;
  known_strengths?: string[];
  known_limits?: string[];
  review_specialties?: string[];
  conflict_of_interest_flags?: string[];
};

export type ClaimCluster = {
  cluster_id: string;
  normalized_claim: string;
  supporting_proposals: string[];
  evidence_refs: string[];
  risk_level: RiskLevel;
};

export type ConflictCluster = {
  cluster_id: string;
  conflict_type:
    | 'same_range_text_conflict'
    | 'api_contract_conflict'
    | 'assumption_conflict'
    | 'risk_policy_conflict'
    | 'artifact_dependency_conflict';
  claims: string[];
  proposals: string[];
  severity: 'blocker' | 'high' | 'medium' | 'low';
};

export type NWayDiff = {
  diff_id: string;
  council_id: string;
  base_ref: string;
  full_consensus: ClaimCluster[];
  partial_agreement: ClaimCluster[];
  disagreement: ConflictCluster[];
  unique_findings: ClaimCluster[];
};

/**
 * Council RFC 的合入授权（人读形状，后端规划中）。
 * ⚠️ 与 core/decision.ts 的权威 `MergeAuthorization`（已实现，见 ./core）字段完全不同，
 * 故此处重命名为 `CouncilMergeAuthorization` 以避免名称冲突。以 core 版为权威对齐目标。
 */
export type CouncilMergeAuthorization = {
  authorized: boolean;
  source: 'human' | 'deterministic_gate';
  selected_proposal_id?: string;
  target_branch: string;
  human_approval_ref?: string;
};

export type DecisionPacket = {
  decision_id: string;
  council_id?: string;
  mode: 'advisory' | 'evidence_only' | 'human_gate';
  outcome: 'approve_merge' | 'request_revision' | 'choose_alternative' | 'reject' | 'defer';
  summary: string;
  recommended_option?: string;
  selected_proposal_id?: string;
  required_action: DecisionPacket['outcome'];
  artifact_refs: string[];
  approval_basis: string[];
  gate_refs: string[];
  merge_authorization_status: 'none' | 'pending_human' | 'authorized';
  merge_authorization?: CouncilMergeAuthorization;
  rationale: string[];
  human_approval_ref?: string;
};

export type CouncilSession = {
  council_id: string;
  origin_task_id: string;
  status: CouncilStatus;
  question: string;
  decision_mode: DecisionPacket['mode'];
  participant_count: number;
  nway_diff?: NWayDiff;
  decision_packet?: DecisionPacket;
  participant_profiles: CouncilParticipantProfileSnapshot[];
};

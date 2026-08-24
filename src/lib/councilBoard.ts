/**
 * 合议面板的数据模型 —— **事件流先行，终态快照补全**。
 *
 * 运行中只有 council.* / market.* 事件（谁被选进席位、谁正在做哪一阶段、谁提了案、
 * 谁评审了、综合完成没有）；终态快照 `snapshot.council` 再把同一批数据补齐、覆盖。
 * 两份数据按 id 合并；两边都没给的字段留空 —— 不虚构占位。
 *
 * 一处曾经的误解：**提案/评审/综合的正文并不需要等快照**。
 * council.proposal.completed 的 payload 里就带着整份 `proposal`，
 * council.review.completed 带着整份 `reviews[]`，council.synthesis.completed 带着
 * 整份 `synthesis`（见 council/providers/synthesis-agent-provider.ts:484/205/263）——
 * 快照的 `council.proposals[]` / `reviews[]` / `synthesis` 本来就是投影器把这些
 * payload 原样搬过去的。所以这里两边都读：快照优先（终态权威），事件兜底（运行中可见）。
 *
 * 铁律同 liveReplay：后端给什么展示什么。裁决由后端 agent 自主完成，
 * 本模型只呈现结果，不承载任何「送回后端」的交互。
 *
 * ⚠️ 这里所有入参都是**不可信 JSON**：`snapshot.council` 的 auctions / participants /
 * proposals / reviews / synthesis / implementation / fatal_error 在后端 zod 里只是
 * `z.record(z.string(), z.unknown())`，事件 payload 更是完全没过校验。所以即使
 * `@/api/types/council` 给了具名类型，本文件仍然一律走 asRecord / str / strList /
 * num 逐字段取值，不做整块 as。
 */
import type { CouncilOutcome } from '@/api/types/council';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];

/** 缺失 / 非数字 → null。**不要补 0** —— 0 在打分和概率里是有意义的真值。 */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const recordList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map((x) => asRecord(x)) : [];

/** 取第一个非空串；全空则空串。 */
const firstStr = (...values: unknown[]): string => {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return '';
};

/** 取第一个非空数组；全空则空数组。 */
const firstStrList = (...values: unknown[]): string[] => {
  for (const value of values) {
    const list = strList(value);
    if (list.length > 0) return list;
  }
  return [];
};

// ══════════════════════════════════════════════════
//  席位竞标（market.auction.* + snapshot.council.auctions[]）
// ══════════════════════════════════════════════════

/**
 * 一条报价的打分明细，摊平自 `score_breakdown`。
 * 后端分组是 relevance/relevance_breakdown 与 quality/quality_breakdown，
 * 这里摊平成同一层，注释标出原来的嵌套位置。
 */
export type CouncilBidScore = {
  relevance: number | null;
  /** relevance_breakdown.persona_match */
  personaMatch: number | null;
  /** relevance_breakdown.skill_match */
  skillMatch: number | null;
  /** relevance_breakdown.experience_match */
  experienceMatch: number | null;
  quality: number | null;
  /** quality_breakdown.success_rate */
  successRate: number | null;
  /** quality_breakdown.avg_confidence */
  avgConfidence: number | null;
  /** quality_breakdown.experience_density */
  experienceDensity: number | null;
  /** quality_breakdown.skill_density */
  skillDensity: number | null;
  capacity: number | null;
  freshness: number | null;
  /** 0..0.15，其余各项都在 0..1 */
  bonus: number | null;
  finalScore: number | null;
};

export type CouncilAuctionBid = {
  bidId: string;
  roleId: string;
  finalScore: number | null;
  /**
   * 这一场 seeded-softmax 的抽样概率（后端取不到时补 0）。
   * **不是通用能力评分，不能跨场比较**；`selectionMode` 不是 'auction' 时压根没跑
   * softmax —— 见 `CouncilAuctionCard.probabilitySampled`。
   */
  probability: number | null;
  estimatedTimeSeconds: number | null;
  strategySummary: string;
  /** `score_breakdown` 整块缺失时为 null */
  score: CouncilBidScore | null;
  /** 由 winner_bid_id 判定；winner_bid_id 缺失时退回 winner_role_id 匹配 */
  winner: boolean;
};

export type CouncilCandidateSkill = { name: string; tags: string[] };

export type CouncilCandidateExperience = {
  name: string;
  /** 后端原文 'positive' | 'negative' */
  type: string;
  confidence: number | null;
  tags: string[];
};

export type CouncilCandidateMetrics = {
  totalTasks: number | null;
  tasksCompleted: number | null;
  tasksSucceeded: number | null;
  skillCount: number | null;
  experienceCount: number | null;
  avgConfidence: number | null;
};

export type CouncilCandidateLoad = {
  activeTaskCount: number | null;
  daysSinceLastTask: number | null;
};

/**
 * 竞标候选人。后端在投影时改过名（agent_id → role_id、metrics_ref → metrics、
 * load_state → load），且列表都截断过（persona_keywords / skills 各 12 条，
 * experiences 8 条，tags 8 条），所以这不是 Agent 的全量画像。
 */
export type CouncilAuctionCandidate = {
  roleId: string;
  personaRef: string;
  personaKeywords: string[];
  skills: CouncilCandidateSkill[];
  experiences: CouncilCandidateExperience[];
  metrics: CouncilCandidateMetrics | null;
  load: CouncilCandidateLoad | null;
};

export type CouncilRequirementProfile = {
  personaKeywords: string[];
  preferredSkillTags: string[];
  preferredExperienceTags: string[];
};

/**
 * 一场席位竞标。`market.auction.started`（候选人 + 需求画像）与
 * `market.auction.completed`（报价 + 赢家 + 凭证）按 auction_id 合并，
 * 快照 `council.auctions[]` 里已经是合并好的同一份数据，再叠一层。
 *
 * 竞标还在跑时只有 started 那半边，所以除 `auctionId` / `status` 外都可能为空。
 */
export type CouncilAuctionCard = {
  auctionId: string;
  /** 后端原文 'running' | 'completed'（快照注入，或由是否收到 completed 事件推出） */
  status: string;
  /** 后端原文 'primary' | 'council_seat'；空串 = 未给 */
  selectionScope: string;
  /**
   * 后端原文 'auction' | 'fixed'（`market.auction.*` 只有这两个取值）。
   * **UI 必须据此决定要不要展示 probability**：不是 'auction' 就没跑 softmax。
   */
  selectionMode: string;
  /** 只有 selectionScope === 'council_seat' 才带 */
  seat: string;
  /** 只有 selectionScope === 'council_seat' 才带 */
  seatIndex: number | null;
  taskDescription: string;
  requirementProfile: CouncilRequirementProfile | null;
  candidates: CouncilAuctionCandidate[];
  policyVersion: string;
  seed: string;
  /** seeded-softmax 温度，0.3..1 */
  tau: number | null;
  /** 按 finalScore 降序；缺分的排最后 */
  bids: CouncilAuctionBid[];
  winnerRoleId: string;
  winnerBidId: string;
  winnerProbability: number | null;
  ledgerRef: string;
  auditRef: string;
  /**
   * 便利位：`selectionMode === 'auction'` 才为 true。为 false 时
   * probability / winnerProbability 没有意义，展示出来就是编造。
   */
  probabilitySampled: boolean;
};

/**
 * 主执行席位的选人结果指纹 —— 来自 `market.selected` 事件与 `snapshot.market`。
 *
 * 它**只记录结果，不含竞标过程**。老 run（以及关掉竞标、selection_mode='fixed' 的 run）
 * 只有这一条，`auctions` 会是空的；这时它是唯一的赢家证据。
 * 快照那半边是 .strict() 的 6 个必填字段，`auctionId` / `selectionMode` 只有事件才带。
 */
export type CouncilPrimarySelection = {
  /** 竞标被关掉时后端不发这个键 */
  auctionId: string;
  /** 后端原文 'auction' | 'fixed'；legacy 流程不发这个键 */
  selectionMode: string;
  winnerAgentId: string;
  winnerBidId: string;
  ledgerRef: string;
  auditRef: string;
  policyVersion: string;
  seed: string;
};

// ══════════════════════════════════════════════════
//  席位名册 / 阶段 / 实施 / 失败
// ══════════════════════════════════════════════════

/**
 * 席位与真实 Agent 的绑定。
 * `council.participants.selected` 发的是**裸** binding（没有 council_seat），
 * 其余 council.* 事件走 participantAuditPayload 才多一个与 seat 同值的 council_seat；
 * 两边 seat 都在，所以这里只留 `seat`。
 */
export type CouncilParticipantCard = {
  /** 形如 cp_<p|r|s><seatIndex>_<8 位十六进制>，本轮实例 id，不是 Agent id */
  participantId: string;
  /** 后端原文 'proposer' | 'reviewer' | 'synthesizer' */
  seat: string;
  seatIndex: number | null;
  /** 指向 B 仓库里真实持久化的 Agent */
  agentId: string;
  roleProfileRef: string;
  /** 竞标出来的席位带 [ledger_ref, audit_ref]，其余席位不带 */
  selectionRefs: string[];
  /** 已见取值 'agent_reused_across_council_seats' / 'best_effort_identity' */
  conflictFlags: string[];
};

/**
 * 一次 `council.phase.started`。两个发射点的字段不一样：
 *  - provider（proposal / review / synthesis）带 participantId / seat / seatIndex / agentId；
 *  - coordinator（plan_first 的 implementation）带 roleId / agentId / sessionId，没有席位信息。
 * 取不到的那半边留空 —— 别拿另一边的值顶上。
 */
export type CouncilPhaseRun = {
  phaseId: string;
  /** 后端原文 'proposal' | 'review' | 'synthesis' | 'implementation' */
  phase: string;
  /** synthesis 会重试，attempt 1..2；其余恒为 1 */
  attempt: number | null;
  participantId: string;
  seat: string;
  seatIndex: number | null;
  agentId: string;
  /** 只有 coordinator 的 implementation 变体带 */
  roleId: string;
  /** 只有 coordinator 的 implementation 变体带 */
  sessionId: string;
  inputArtifactRefs: string[];
  /** 事件时间的 HH:MM:SS，与 feed 同格式 */
  time: string;
};

/**
 * plan_first 策略下，主 Agent 按最终 Plan 实施的那一段。
 * 快照优先（投影器取 `council.completed` 的 plan_execution，只有 6 个字段），
 * 事件 `council.implementation.completed` 补上 councilRunId / phaseId / agentId / response。
 */
export type CouncilImplementationCard = {
  councilRunId: string;
  phaseId: string;
  executorRoleId: string;
  agentId: string;
  sessionId: string;
  agentRunId: string;
  driverRunResultId: string;
  finalPlanArtifactRefs: string[];
  implementationArtifactRefs: string[];
  /** 实施 Agent 的完整回复正文，可能很长；快照走 plan_execution 时没有这个字段 */
  response: string;
};

/**
 * 一次 `council.role.failed` —— **单个席位**执行失败。
 *
 * ⚠️ 这**不是**合议的终态：后端 tryRunRole 吞掉这个错误、把
 * `${code}:${participant_id}` 记进 diagnostic_refs，然后**带着缺席的席位继续跑**
 * （fallbackAction 恒为 'continue_with_available_evidence'）。所以它只进
 * `roleFailures` 这个告警列表，绝不翻转 `status`。合议真的挂了走的是 `council.failed`。
 */
export type CouncilRoleFailure = {
  /** 后端原文 COUNCIL_PROPOSAL_FAILED / COUNCIL_REVIEW_FAILED / COUNCIL_SYNTHESIS_FAILED */
  code: string;
  /** 后端原文 'proposal' | 'review' | 'synthesis'（payload.council_phase） */
  councilPhase: string;
  participantId: string;
  seat: string;
  seatIndex: number | null;
  agentId: string;
  /** 后端原文 'completed' | 'failed' | 'cancelled' | 'interrupted' */
  agentStatus: string;
  agentRunId: string;
  driverRunResultId: string;
  /** 后端只有一个取值 'continue_with_available_evidence' */
  fallbackAction: string;
  /** failure_details.error_message，取不到退回 driver_error_message */
  errorMessage: string;
  /** failure_details.driver_error_code */
  driverErrorCode: string;
  /** 事件时间的 HH:MM:SS，与 feed 同格式 */
  time: string;
};

/**
 * `council.failed` / `snapshot.council.fatal_error` —— 合议阶段抛异常终止。
 * 出现它 `status` 就是 failed。
 */
export type CouncilFatalErrorCard = {
  /**
   * 已见 COUNCIL_EXECUTION_FAILED / COUNCIL_NO_SELECTED_ARTIFACT /
   * COUNCIL_RESULT_MISSING / COUNCIL_IMPLEMENTATION_FAILED，但后端形参是裸 string，
   * 别做穷尽 switch。
   */
  code: string;
  message: string;
  /** 后端两个发射点都写死 true */
  fatal: boolean;
};

/** `snapshot.council.result`（后端 CouncilResult）。`quality` 仅审计用，不是完成判定依据。 */
export type CouncilResultCard = {
  /** 后端原文 'verified' | 'best_effort' */
  quality: string;
  finalArtifactRef: string;
  finalArtifactSha256: string;
  warnings: string[];
  unmetCriteria: string[];
  verificationRefs: string[];
  decisionRecordRef: string;
};

// ══════════════════════════════════════════════════
//  卡片（既有导出，形状不变）
// ══════════════════════════════════════════════════

export type CouncilReviewCard = {
  reviewId: string;
  proposalId: string;
  /** 评审员的 agent_id（Review.reviewer_id） */
  reviewerId: string;
  /** 后端原文 approve / reject / needs_revision；空串 = 两个来源都没给 */
  verdict: string;
  reason: string;
};

export type CouncilProposalCard = {
  proposalId: string;
  /**
   * 提案人的真实长期 Agent id。
   *
   * ⚠️ 事件里这个字段叫 **`agent_id`**（participantAuditPayload 展开的），不叫 role_id ——
   * council.proposal.completed 的 payload 根本没有 role_id 这个键。属性名保留 roleId
   * 是为了不惊动既有调用方，取值来源以 agent_id 为先。
   */
  roleId: string;
  /** 本轮席位实例 id；快照补入的提案没有这个键 */
  participantId: string;
  /** 后端原文 'proposer'；快照补入的提案没有这个键 */
  seat: string;
  /** 以下正文字段：快照优先，取不到就用事件自带的 payload.proposal */
  summary: string;
  affectedPaths: string[];
  assumptions: string[];
  knownRisks: string[];
  completionEvidence: string[];
  artifactRefs: string[];
  reviews: CouncilReviewCard[];
  selected: boolean;
};

/**
 * `council.output.generated_artifact_refs[]` 里的一条产物。
 *
 * 同一个文件路径通常会出现**多份** —— 每位提案者在自己的席位工作区里各写了一份，
 * 综合席位再写一份。`source` 就是从 `metadata.workspace_path` 尾部取的席位目录名
 * （形如 `cp_p0_48d4ac79`），用它才能把「谁产出的」对上号；后端在这里给的
 * `producer_id` 是 driver 名（claude），不是席位。
 */
export type CouncilGeneratedArtifact = {
  artifactId: string;
  /** 后端原文 file / patch / text / metadata… */
  type: string;
  /** 相对工作区的路径；缺失时退回 uri */
  targetPath: string;
  sha256: string;
  mediaType: string;
  /** 产出它的席位 participant_id；对不上时为空 */
  source: string;
  createdAt: string;
};

/**
 * `snapshot.council.output` —— 合议的交付信封。
 *
 * 与 `result` / `outcome` 有重叠（都带 selected_artifact_refs），但只有它带
 * `generated_artifact_refs`：每个席位各自产出了什么文件。这是「交付与验证」区
 * 唯一的数据来源。注意它和 proposals/reviews 一样由投影器写出、没过 zod，
 * 所以逐字段防御性读取。
 */
export type CouncilOutputCard = {
  outputId: string;
  /** 后端原文 selected / needs_human / request_revision / rejected */
  status: string;
  decisionRef: string;
  selectedArtifactRefs: string[];
  generatedArtifacts: CouncilGeneratedArtifact[];
  canCreateMergeAuthorization: boolean;
};

export type CouncilBoardModel = {
  /** running / completed / failed（事件推导，快照到达后以快照为准） */
  status: string;
  /**
   * 合议当前阶段。后端 8 值枚举 selecting / proposal / review / synthesis /
   * implementation / decision / completed / failed；一条 council.* 都没有时为空串。
   * 快照优先，没有快照时用与后端投影器 councilPhase() 相同的倒扫规则从事件推。
   */
  phase: string;
  /** 本轮 Council 的实例 id（council_run_id） */
  councilRunId: string;
  /** 议题正文 —— `council.started` 回显的 task spec，可能很长 */
  subject: string;
  /** 已见 'classic' / 'adaptive_lead' / 'plan_first'；后端声明为裸 string */
  strategy: string;
  /** 后端原文 'plan' | 'implementation'。plan_first 产出 plan，其余产出 implementation。 */
  artifactMode: string;
  decisionMode: string;
  trigger: string;
  /** = fatalError?.code；没有致命错误时空串 */
  failedCode: string;
  proposals: CouncilProposalCard[];
  synthesis: {
    synthesisId: string;
    roleId: string;
    summary: string;
    artifactRefs: string[];
  } | null;
  decision: {
    /** 后端原文 select / needs_human / request_revision / reject */
    verdict: string;
    decisionId: string;
    selectedProposalId: string;
    /** CouncilDecision.reason —— 裁决理由正文，live 路径唯一的说理字段 */
    reason: string;
    /**
     * ⚠️ 只有 legacy 的 integration-v0 流程发 `termination_reason`（值就是 verdict 回显）。
     * 当前 live 路径的 council.decision 展开的是 CouncilDecision，**没有这个键** ——
     * 实跑永远是空串，说理请读上面的 `reason`。
     */
    terminationReason: string;
    selectedArtifactRefs: string[];
  } | null;
  /** 席位竞标全过程；只有 council 模式的快照才投影这个字段 */
  auctions: CouncilAuctionCard[];
  /** 主席位选人结果指纹；`auctions` 为空的老 run 靠它才看得到赢家 */
  primarySelection: CouncilPrimarySelection | null;
  participants: CouncilParticipantCard[];
  /**
   * 名册是怎么定的。后端原文 'explicit' | 'fixed' | 'auction' | 'board_order'。
   * 只有 'auction' 才跑了竞标 —— 另外三种没有 probability 可言。
   */
  participantSelectionMode: string;
  /** 全部 `council.phase.started`，事件序 */
  phases: CouncilPhaseRun[];
  /** 最后一条 `council.phase.started` —— 「谁正在做什么」 */
  activePhase: CouncilPhaseRun | null;
  implementation: CouncilImplementationCard | null;
  /** 单席位失败告警列表。**不翻转 status** —— 见 `CouncilRoleFailure` 的说明。 */
  roleFailures: CouncilRoleFailure[];
  fatalError: CouncilFatalErrorCard | null;
  /** 交付信封：各席位产出了哪些文件。`result` / `outcome` 都不带这个。 */
  output: CouncilOutputCard | null;
  result: CouncilResultCard | null;
  /**
   * `snapshot.council.outcome` 原样透传（snake_case）。
   * 这是 council 段里**唯一**在后端过了 zod 校验的块（councilOutcomeEvidenceSchema
   * 是 .strict() 的），所以直接给具名 DTO，不再摊平成 camelCase。
   */
  outcome: CouncilOutcome | null;
  requiredNextActions: string[];
  blockedBy: string[];
  /**
   * 合议过程一览（事件序）：time + 类型 + 执行者。只收 council.*，不收 market.*。
   * `roleId` 取 payload.agent_id（audit 块），legacy 的 role_id 作回落。
   */
  feed: { time: string; type: string; roleId: string }[];
};

// ══════════════════════════════════════════════════
//  构建
// ══════════════════════════════════════════════════

const hhmmss = (createdAt: string): string => createdAt.slice(11, 19);

const scoreOf = (raw: unknown): CouncilBidScore | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = asRecord(raw);
  const relevance = asRecord(s.relevance_breakdown);
  const quality = asRecord(s.quality_breakdown);
  return {
    relevance: num(s.relevance),
    personaMatch: num(relevance.persona_match),
    skillMatch: num(relevance.skill_match),
    experienceMatch: num(relevance.experience_match),
    quality: num(s.quality),
    successRate: num(quality.success_rate),
    avgConfidence: num(quality.avg_confidence),
    experienceDensity: num(quality.experience_density),
    skillDensity: num(quality.skill_density),
    capacity: num(s.capacity),
    freshness: num(s.freshness),
    bonus: num(s.bonus),
    finalScore: num(s.final_score),
  };
};

const candidateOf = (raw: Record<string, unknown>): CouncilAuctionCandidate => {
  const metrics = raw.metrics;
  const load = raw.load;
  const m = asRecord(metrics);
  const l = asRecord(load);
  return {
    roleId: str(raw.role_id),
    personaRef: str(raw.persona_ref),
    personaKeywords: strList(raw.persona_keywords),
    skills: recordList(raw.skills).map((skill) => ({
      name: str(skill.name),
      tags: strList(skill.tags),
    })),
    experiences: recordList(raw.experiences).map((experience) => ({
      name: str(experience.name),
      type: str(experience.type),
      confidence: num(experience.confidence),
      tags: strList(experience.tags),
    })),
    metrics:
      typeof metrics === 'object' && metrics !== null
        ? {
            totalTasks: num(m.total_tasks),
            tasksCompleted: num(m.tasks_completed),
            tasksSucceeded: num(m.tasks_succeeded),
            skillCount: num(m.skill_count),
            experienceCount: num(m.experience_count),
            avgConfidence: num(m.avg_confidence),
          }
        : null,
    load:
      typeof load === 'object' && load !== null
        ? {
            activeTaskCount: num(l.active_task_count),
            daysSinceLastTask: num(l.days_since_last_task),
          }
        : null,
  };
};

const auctionOf = (raw: Record<string, unknown>): CouncilAuctionCard => {
  const winnerBidId = str(raw.winner_bid_id);
  const winnerRoleId = str(raw.winner_role_id);
  const profile = raw.requirement_profile;
  const p = asRecord(profile);
  const bids: CouncilAuctionBid[] = recordList(raw.bids).map((bid) => {
    const bidId = str(bid.bid_id);
    const roleId = str(bid.role_id);
    return {
      bidId,
      roleId,
      finalScore: num(bid.final_score),
      probability: num(bid.probability),
      estimatedTimeSeconds: num(bid.estimated_time_seconds),
      strategySummary: str(bid.strategy_summary),
      score: scoreOf(bid.score_breakdown),
      winner:
        winnerBidId !== ''
          ? bidId !== '' && bidId === winnerBidId
          : winnerRoleId !== '' && roleId === winnerRoleId,
    };
  });
  // 降序排名；没有 final_score 的排最后（后端漏发也不许当 0 处理）
  bids.sort((left, right) => (right.finalScore ?? -Infinity) - (left.finalScore ?? -Infinity));
  const selectionMode = str(raw.selection_mode);
  return {
    auctionId: str(raw.auction_id),
    status: str(raw.status),
    selectionScope: str(raw.selection_scope),
    selectionMode,
    seat: str(raw.seat),
    seatIndex: num(raw.seat_index),
    taskDescription: str(raw.task_description),
    requirementProfile:
      typeof profile === 'object' && profile !== null
        ? {
            personaKeywords: strList(p.persona_keywords),
            preferredSkillTags: strList(p.preferred_skill_tags),
            preferredExperienceTags: strList(p.preferred_experience_tags),
          }
        : null,
    candidates: recordList(raw.candidates).map(candidateOf),
    policyVersion: str(raw.policy_version),
    seed: str(raw.seed),
    tau: num(raw.tau),
    bids,
    winnerRoleId,
    winnerBidId,
    winnerProbability: num(raw.winner_probability),
    ledgerRef: str(raw.ledger_ref),
    auditRef: str(raw.audit_ref),
    probabilitySampled: selectionMode === 'auction',
  };
};

const participantOf = (raw: Record<string, unknown>): CouncilParticipantCard => ({
  participantId: str(raw.participant_id),
  seat: str(raw.seat) || str(raw.council_seat),
  seatIndex: num(raw.seat_index),
  agentId: str(raw.agent_id),
  roleProfileRef: str(raw.role_profile_ref),
  selectionRefs: strList(raw.selection_refs),
  conflictFlags: strList(raw.conflict_flags),
});

/**
 * 与后端投影器 `councilPhase()`（app/task-run-snapshot-projector.ts）同规则的倒扫。
 * 只在快照还没到（运行中）时用；快照带 `council.phase` 就以快照为准。
 */
const derivePhase = (events: RunEvent[]): string => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const type = events[i].type;
    if (type === 'council.completed') return 'completed';
    if (type === 'council.failed') return 'failed';
    if (type === 'council.decision') return 'decision';
    if (type === 'council.implementation.completed') return 'implementation';
    if (type === 'council.synthesis.completed') return 'synthesis';
    if (type === 'council.review.completed') return 'review';
    if (type === 'council.proposal.completed') return 'proposal';
    if (type !== 'council.phase.started') continue;
    const phase = str(asRecord(events[i].payload).phase);
    if (
      phase === 'proposal' ||
      phase === 'review' ||
      phase === 'synthesis' ||
      phase === 'implementation'
    ) {
      return phase;
    }
  }
  return events.some((e) => e.type === 'council.started') ? 'selecting' : '';
};

/**
 * timeline (+ 终态快照的 council / market 段) → 面板模型。没有任何合议数据 → null。
 *
 * `market` 只做补充：它自己撑不起一块合议面板（单 agent 跑也会有 market.selected），
 * 所以判空仍然只看 council.* 事件和 `council` 快照。
 */
export function buildCouncilBoard(
  timeline: RunEvent[],
  council?: NonNullable<RunSnapshot['council']>,
  market?: RunSnapshot['market'],
): CouncilBoardModel | null {
  const events = timeline.filter((e) => e.type.startsWith('council.'));
  const marketEvents = timeline.filter((e) => e.type.startsWith('market.'));
  if (events.length === 0 && !council) return null;

  const payloadOf = (type: string): Record<string, unknown> => {
    const event = events.find((e) => e.type === type);
    return event ? asRecord(event.payload) : {};
  };
  /** 同类型事件重复发时以最后一条为准（后端投影器也是 lastEvent 语义）。 */
  const lastPayloadOf = (type: string): Record<string, unknown> => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].type === type) return asRecord(events[i].payload);
    }
    return {};
  };

  // 提案骨架来自事件（运行中即出现）；正文优先取快照，取不到就用事件自带的 payload.proposal。
  const snapshotProposals = new Map<string, Record<string, unknown>>();
  for (const raw of council?.proposals ?? []) {
    const p = asRecord(raw);
    snapshotProposals.set(str(p.proposal_id), p);
  }

  // 快照优先，没有快照就摊平各条 council.review.completed 的 payload.reviews
  // —— 与后端投影器 preferRecords() 同规则。
  const reviewRecords: Record<string, unknown>[] =
    (council?.reviews ?? []).length > 0
      ? (council?.reviews ?? []).map((raw) => asRecord(raw))
      : events
          .filter((e) => e.type === 'council.review.completed')
          .flatMap((e) => recordList(asRecord(e.payload).reviews));

  const reviews: CouncilReviewCard[] = reviewRecords.map((r) => ({
    reviewId: str(r.review_id),
    proposalId: str(r.proposal_id),
    reviewerId: str(r.reviewer_id),
    verdict: str(r.verdict),
    reason: str(r.reason),
  }));

  const decisionEvent = payloadOf('council.decision');
  const completedEvent = payloadOf('council.completed');
  const startedEvent = payloadOf('council.started');
  const selectedProposalId =
    council?.selected_proposal_id ?? str(decisionEvent.selected_proposal_id);

  const proposalCards: CouncilProposalCard[] = events
    .filter((e) => e.type === 'council.proposal.completed')
    .map((e) => {
      const payload = asRecord(e.payload);
      const proposalId = str(payload.proposal_id);
      const snap = snapshotProposals.get(proposalId) ?? {};
      // 事件里就带着整份 Proposal（`payload.proposal`），不必等快照。
      const body = asRecord(payload.proposal);
      return {
        proposalId,
        participantId: str(payload.participant_id),
        seat: str(payload.seat) || str(payload.council_seat),
        roleId: firstStr(payload.agent_id, payload.role_id, body.agent_id, snap.agent_id),
        summary: firstStr(snap.summary, body.summary),
        affectedPaths: firstStrList(snap.affected_paths, body.affected_paths),
        assumptions: firstStrList(snap.assumptions, body.assumptions),
        knownRisks: firstStrList(snap.known_risks, body.known_risks),
        completionEvidence: firstStrList(snap.completion_evidence, body.completion_evidence),
        artifactRefs: firstStrList(snap.artifact_refs, payload.artifact_refs, body.artifact_refs),
        reviews: reviews.filter((r) => r.proposalId === proposalId),
        selected: proposalId !== '' && proposalId === selectedProposalId,
      };
    });
  // 快照里有、事件里没有的提案（理论上不该发生，但不丢数据）
  for (const [proposalId, snap] of snapshotProposals) {
    if (proposalCards.some((p) => p.proposalId === proposalId)) continue;
    proposalCards.push({
      proposalId,
      participantId: '',
      seat: '',
      roleId: str(snap.agent_id),
      summary: str(snap.summary),
      affectedPaths: strList(snap.affected_paths),
      assumptions: strList(snap.assumptions),
      knownRisks: strList(snap.known_risks),
      completionEvidence: strList(snap.completion_evidence),
      artifactRefs: strList(snap.artifact_refs),
      reviews: reviews.filter((r) => r.proposalId === proposalId),
      selected: proposalId !== '' && proposalId === selectedProposalId,
    });
  }

  const synthesisEvent = payloadOf('council.synthesis.completed');
  // 与提案同理：事件里就带着整份 CouncilSynthesis（`payload.synthesis`）。
  const eventSynthesis = asRecord(synthesisEvent.synthesis);
  const snapSynthesis = council?.synthesis ? asRecord(council.synthesis) : {};
  const synthesisId = firstStr(
    snapSynthesis.synthesis_id,
    synthesisEvent.synthesis_id,
    eventSynthesis.synthesis_id,
  );
  const synthesis = synthesisId
    ? {
        synthesisId,
        roleId: firstStr(
          synthesisEvent.agent_id,
          synthesisEvent.role_id,
          snapSynthesis.synthesizer_id,
          eventSynthesis.synthesizer_id,
        ),
        summary: firstStr(snapSynthesis.summary, eventSynthesis.summary),
        artifactRefs: firstStrList(
          snapSynthesis.artifact_refs,
          synthesisEvent.artifact_refs,
          eventSynthesis.artifact_refs,
        ),
      }
    : null;

  const verdict = council?.verdict ?? str(decisionEvent.verdict);
  const decision = verdict
    ? {
        verdict,
        decisionId: council?.decision_id ?? str(completedEvent.decision_id),
        selectedProposalId,
        reason: str(decisionEvent.reason),
        terminationReason: str(decisionEvent.termination_reason),
        selectedArtifactRefs:
          council?.selected_artifact_refs ?? strList(completedEvent.selected_artifact_refs),
      }
    : null;

  // ── 竞标：事件按 auction_id 合并（completed 后铺），快照再叠一层 ──
  const auctionRaw = new Map<string, Record<string, unknown>>();
  for (const e of marketEvents) {
    if (e.type !== 'market.auction.started' && e.type !== 'market.auction.completed') continue;
    const payload = asRecord(e.payload);
    const auctionId = str(payload.auction_id);
    if (!auctionId) continue;
    auctionRaw.set(auctionId, {
      ...(auctionRaw.get(auctionId) ?? {}),
      ...payload,
      status: e.type === 'market.auction.completed' ? 'completed' : 'running',
    });
  }
  for (const raw of council?.auctions ?? []) {
    const snap = asRecord(raw);
    const auctionId = str(snap.auction_id);
    if (!auctionId) continue;
    auctionRaw.set(auctionId, { ...(auctionRaw.get(auctionId) ?? {}), ...snap });
  }

  // ── 主席位选人指纹：market.selected 事件 + snapshot.market ──
  const marketSelected = (() => {
    for (let i = marketEvents.length - 1; i >= 0; i -= 1) {
      if (marketEvents[i].type === 'market.selected') return asRecord(marketEvents[i].payload);
    }
    return {};
  })();
  const primaryWinnerAgentId = firstStr(market?.winner_agent_id, marketSelected.winner_agent_id);
  const primarySelection: CouncilPrimarySelection | null = primaryWinnerAgentId
    ? {
        auctionId: str(marketSelected.auction_id),
        selectionMode: str(marketSelected.selection_mode),
        winnerAgentId: primaryWinnerAgentId,
        winnerBidId: firstStr(market?.winner_bid_id, marketSelected.winner_bid_id),
        ledgerRef: firstStr(market?.ledger_ref, marketSelected.ledger_ref),
        auditRef: firstStr(market?.audit_ref, marketSelected.audit_ref),
        policyVersion: firstStr(market?.policy_version, marketSelected.policy_version),
        seed: firstStr(market?.seed, marketSelected.seed),
      }
    : null;
  // market.selected 与 market.auction.completed 的 winner 同源（都是 result.winner_agent_id），
  // 所以 auction_id 对得上时可以补齐只收到 started 的那一场的赢家 —— 不是编造，是同一份数据。
  if (primarySelection?.auctionId) {
    const target = auctionRaw.get(primarySelection.auctionId);
    if (target && !str(target.winner_role_id)) {
      auctionRaw.set(primarySelection.auctionId, {
        ...target,
        winner_role_id: primarySelection.winnerAgentId,
        ...(primarySelection.winnerBidId ? { winner_bid_id: primarySelection.winnerBidId } : {}),
        ...(primarySelection.ledgerRef ? { ledger_ref: primarySelection.ledgerRef } : {}),
        ...(primarySelection.auditRef ? { audit_ref: primarySelection.auditRef } : {}),
        ...(primarySelection.policyVersion
          ? { policy_version: primarySelection.policyVersion }
          : {}),
      });
    }
  }
  const auctions = [...auctionRaw.values()].map(auctionOf);

  // ── 席位名册：快照优先（投影器已经挑过 completed / participants.selected），
  //    没有快照时回落到事件 ──
  const participantsEvent = lastPayloadOf('council.participants.selected');
  const participantsRaw =
    (council?.participants ?? []).length > 0
      ? (council?.participants ?? []).map((raw) => asRecord(raw))
      : recordList(participantsEvent.participants);
  const participants = participantsRaw.map(participantOf);

  // ── 阶段历史 ──
  const phases: CouncilPhaseRun[] = events
    .filter((e) => e.type === 'council.phase.started')
    .map((e) => {
      const payload = asRecord(e.payload);
      return {
        phaseId: str(payload.phase_id),
        phase: str(payload.phase),
        attempt: num(payload.attempt),
        participantId: str(payload.participant_id),
        seat: str(payload.seat) || str(payload.council_seat),
        seatIndex: num(payload.seat_index),
        agentId: str(payload.agent_id),
        roleId: str(payload.role_id),
        sessionId: str(payload.session_id),
        inputArtifactRefs: strList(payload.input_artifact_refs),
        time: hhmmss(e.created_at),
      };
    });

  // ── 实施段：快照优先，事件补 response / agent_id / phase_id / council_run_id ──
  const implementationEvent = lastPayloadOf('council.implementation.completed');
  const snapImplementation = council?.implementation ? asRecord(council.implementation) : {};
  const hasImplementation =
    Object.keys(snapImplementation).length > 0 || Object.keys(implementationEvent).length > 0;
  const implementation: CouncilImplementationCard | null = hasImplementation
    ? {
        councilRunId: firstStr(
          snapImplementation.council_run_id,
          implementationEvent.council_run_id,
        ),
        phaseId: firstStr(snapImplementation.phase_id, implementationEvent.phase_id),
        executorRoleId: firstStr(
          snapImplementation.executor_role_id,
          implementationEvent.executor_role_id,
        ),
        agentId: firstStr(snapImplementation.agent_id, implementationEvent.agent_id),
        sessionId: firstStr(snapImplementation.session_id, implementationEvent.session_id),
        agentRunId: firstStr(snapImplementation.agent_run_id, implementationEvent.agent_run_id),
        driverRunResultId: firstStr(
          snapImplementation.driver_run_result_id,
          implementationEvent.driver_run_result_id,
        ),
        finalPlanArtifactRefs: firstStrList(
          snapImplementation.final_plan_artifact_refs,
          implementationEvent.final_plan_artifact_refs,
        ),
        implementationArtifactRefs: firstStrList(
          snapImplementation.implementation_artifact_refs,
          implementationEvent.implementation_artifact_refs,
        ),
        response: firstStr(snapImplementation.response, implementationEvent.response),
      }
    : null;

  // ── 单席位失败：告警列表，不是终态 ──
  const roleFailures: CouncilRoleFailure[] = events
    .filter((e) => e.type === 'council.role.failed')
    .map((e) => {
      const payload = asRecord(e.payload);
      const details = asRecord(payload.failure_details);
      return {
        code: str(payload.code),
        councilPhase: str(payload.council_phase),
        participantId: str(payload.participant_id),
        seat: str(payload.seat) || str(payload.council_seat),
        seatIndex: num(payload.seat_index),
        agentId: str(payload.agent_id),
        agentStatus: str(payload.agent_status),
        agentRunId: str(payload.agent_run_id),
        driverRunResultId: str(payload.driver_run_result_id),
        fallbackAction: str(payload.fallback_action),
        errorMessage: firstStr(details.error_message, details.driver_error_message),
        driverErrorCode: str(details.driver_error_code),
        time: hhmmss(e.created_at),
      };
    });

  // ── 致命错误：快照优先，事件回落 ──
  const fatalEvent = lastPayloadOf('council.failed');
  const snapFatal = council?.fatal_error ? asRecord(council.fatal_error) : {};
  const fatalCode = firstStr(snapFatal.code, fatalEvent.code);
  const fatalError: CouncilFatalErrorCard | null = fatalCode
    ? {
        code: fatalCode,
        message: firstStr(snapFatal.message, fatalEvent.message),
        fatal: snapFatal.fatal === true || fatalEvent.fatal === true,
      }
    : null;

  const snapOutput = council?.output ? asRecord(council.output) : {};
  const output: CouncilOutputCard | null =
    Object.keys(snapOutput).length > 0
      ? {
          outputId: str(snapOutput.output_id),
          status: str(snapOutput.status),
          decisionRef: str(snapOutput.decision_ref),
          selectedArtifactRefs: strList(snapOutput.selected_artifact_refs),
          generatedArtifacts: recordList(snapOutput.generated_artifact_refs).map((raw) => {
            const content = asRecord(raw.content);
            const metadata = asRecord(raw.metadata);
            const workspace = str(metadata.workspace_path);
            return {
              artifactId: str(raw.artifact_id),
              type: str(raw.type),
              targetPath: firstStr(content.target_path, metadata.target_path) || str(raw.uri),
              sha256: str(raw.sha256),
              mediaType: str(content.media_type),
              source: workspace ? (workspace.split('/').filter(Boolean).slice(-1)[0] ?? '') : '',
              createdAt: str(raw.created_at),
            };
          }),
          canCreateMergeAuthorization: snapOutput.can_create_merge_authorization === true,
        }
      : null;

  const snapResult = council?.result ? asRecord(council.result) : {};
  const result: CouncilResultCard | null =
    Object.keys(snapResult).length > 0
      ? {
          quality: str(snapResult.quality),
          finalArtifactRef: str(snapResult.final_artifact_ref),
          finalArtifactSha256: str(snapResult.final_artifact_sha256),
          warnings: strList(snapResult.warnings),
          unmetCriteria: strList(snapResult.unmet_criteria),
          verificationRefs: strList(snapResult.verification_refs),
          decisionRecordRef: str(snapResult.decision_record_ref),
        }
      : null;

  // council.role.failed 不在这里参与判定 —— 它是单席位告警，后端带着缺席继续跑。
  const statusFromEvents = events.some((e) => e.type === 'council.failed')
    ? 'failed'
    : events.some((e) => e.type === 'council.completed')
      ? 'completed'
      : 'running';

  return {
    status: council?.status ?? statusFromEvents,
    phase: council?.phase ?? derivePhase(events),
    councilRunId: firstStr(
      council?.council_run_id,
      completedEvent.council_run_id,
      decisionEvent.council_run_id,
      participantsEvent.council_run_id,
      synthesisEvent.council_run_id,
    ),
    subject: firstStr(council?.subject, startedEvent.subject),
    strategy: firstStr(council?.strategy, completedEvent.strategy, startedEvent.strategy),
    artifactMode: firstStr(council?.artifact_mode, startedEvent.artifact_mode),
    decisionMode:
      council?.decision_mode ??
      (str(decisionEvent.decision_mode) || str(startedEvent.decision_mode)),
    trigger: str(startedEvent.trigger),
    failedCode: fatalError?.code ?? '',
    proposals: proposalCards,
    synthesis,
    decision,
    auctions,
    primarySelection,
    participants,
    participantSelectionMode: str(participantsEvent.selection_mode),
    phases,
    activePhase: phases.length > 0 ? phases[phases.length - 1] : null,
    implementation,
    roleFailures,
    fatalError,
    output,
    result,
    outcome: council?.outcome ?? null,
    requiredNextActions: (council?.required_next_actions ?? []).map((a) => str(a)).filter(Boolean),
    blockedBy: (council?.blocked_by ?? []).map((b) => str(b)).filter(Boolean),
    feed: events.map((e) => {
      const payload = asRecord(e.payload);
      return {
        time: hhmmss(e.created_at),
        type: e.type,
        roleId: firstStr(payload.agent_id, payload.role_id),
      };
    }),
  };
}

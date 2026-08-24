/**
 * 方向 B · 记忆 / 上下文装配契约 —— 对齐 BCD `src/memory/contract.ts`（newide-scaffold）。
 *
 * ContextPack 是 Coordinator → Agent 之间传递记忆信息的数据载体。
 *
 * 本文件同时是 32 个 `memory.*` JSON-RPC 方法的**线上形状**镜像。权威源逐字对齐：
 *   - `packages/newide-bcd/src/rpc/memory-methods.ts`（参数 zod schema + result 信封键）
 *   - `packages/newide-bcd/src/app/b-memory-backend-service.ts`（capabilities / buffer / search）
 *   - `packages/newide-bcd/src/memory/ports/*`（AgentBoard / Buffer / Repository DTO）
 *   - `packages/newide-bcd/src/memory/schemas.ts`（Persona / Metrics / Buffer / Skill 的 Zod）
 *   - `packages/newide-bcd/src/memory/services/*`（overview / retirement / market / feedback / writer）
 *
 * 命名约定：某个 RPC 直接返回的线上 DTO 一律 `Rpc…` 前缀；只作为入参的补丁 / 过滤器
 * 用 `Memory…` 前缀。字段名保持后端的 snake_case，**不做驼峰改写**（唯一例外见
 * `RpcPendingBuffer.agentContext` 的注释）。
 */

import type {
  ArtifactId,
  ContextPackId,
  MemoryRef,
  RoleProfileRef,
  SchemaVersion,
  TaskId,
  Timestamp,
} from './core';

export interface ContextPack {
  context_pack_id: ContextPackId;
  task_id: TaskId;
  role_profile_ref: RoleProfileRef;
  memory_refs: MemoryRef[];
  artifact_refs: ArtifactId[];
  summary: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/**
 * 记忆装配策略（memory/contract.ts 版本）。
 * ⚠️ 与 core/message.ts 的 `RoleMemoryPolicy`（见 ./core）同名不同字段 —— 这是上游命名冲突。
 * 此处为"装配侧"策略：控制 ContextPack 装入哪些类型的记忆。
 */
export interface MemoryPolicy {
  include_persona: boolean;
  include_skills: boolean;
  include_recent_experience: boolean;
  max_memory_items: number;
}

export interface BuildContextPackInput {
  task_id: TaskId;
  role_profile_ref: RoleProfileRef;
  memory_refs?: MemoryRef[];
  artifact_refs?: ArtifactId[];
  summary_hint?: string;
}

// ── 枚举字面量（对齐 memory/schemas.ts 的 z.enum） ──

/** Agent 生命周期状态（`AgentStatusSchema`）。线上 DTO 的 `status` 仍声明为宽 string。 */
export type MemoryAgentStatus = 'created' | 'active' | 'idle' | 'draining' | 'retired';

/**
 * 用户对任务完成情况的评分（`UserRatingSchema`），`memory.rateTask` 的核心入参。
 * 各值对应的置信度增量（services/feedback.ts `CONFIDENCE_DELTA`）：
 * - `resolved` 已解决 → +0.05
 * - `partially_resolved` 部分解决 → 0
 * - `unresolved` 未解决 → −0.1
 * - `not_rated` 不予评分 → 0
 * 增量会 clamp 到 [0,1] 并四舍五入到 3 位小数，同时向 confidence_history 追加一条
 * reason 为 `user_rating:<rating>` 的记录。
 */
export type MemoryUserRating = 'resolved' | 'partially_resolved' | 'unresolved' | 'not_rated';

/** Agent 退休原因（`RetiredReasonSchema`）。 */
export type MemoryRetiredReason =
  | 'performance_degradation'
  | 'inactivity'
  | 'persona_drift'
  | 'manual'
  | 'split';

/** 退休时是否创建替代 Agent（services/retirement.ts `RetireOptions.replacement`，默认 none）。 */
export type MemoryReplacementStrategy = 'clean_slate' | 'seeded_slate' | 'none';

/** 退休扫描的建议动作（`RetirementAction`）。仅建议，扫描本身从不真的退休。 */
export type MemoryRetirementAction = 'retire' | 'warn' | 'keep';

/** 退休三重门控的层名（`RetirementLayer`）。 */
export type MemoryRetirementLayer = 'statistical' | 'persona_drift' | 'llm';

/** 技能审核状态（`ReviewStatusSchema`）。线上 DTO 的 `review_status` 声明为宽 string。 */
export type MemoryReviewStatus = 'pending' | 'approved' | 'rejected';

/**
 * 技能在市场中的状态（`MarketStatusSchema`）。
 * `retired_unique` 只由退休流程写入（无人引入过的技能迁入市场池时），手工 PATCH 写不进。
 */
export type MemoryMarketStatus = 'available' | 'superseded' | 'retired_unique';

/** `memory.updateSkill` 允许手工写入的 market_status 子集（RPC 层 zod 收窄，不含 retired_unique）。 */
export type MemoryMarketStatusPatch = 'available' | 'superseded';

/** 缓冲区报告的提取状态机（`ExtractionStatusSchema`）。 */
export type MemoryExtractionStatus = 'pending' | 'processing' | 'processed' | 'dead_letter';

/** 经验类型（`ExperienceTypeSchema`）：正经验记成功方案，负经验记失败教训。 */
export type MemoryExperienceType = 'positive' | 'negative';

/** 引用经验 / 本次任务的效果评估（`EffectivenessSchema`）。 */
export type MemoryEffectiveness =
  | 'fully_effective'
  | 'partially_effective'
  | 'ineffective'
  | 'not_applicable';

// ── memory.getCapabilities ──

export interface MemoryOperationCapability {
  status: 'available' | 'unavailable';
  /** unavailable 时说明缺哪个依赖；promote_skills 即使 available 也总带一句说明。 */
  reason?: string;
}

/** embedding 运行时信息（`BEmbeddingRuntimeInfo`，production-b-runtime.ts）。 */
export interface MemoryEmbeddingRuntime {
  /** provider 类名，如 `HashEmbeddingProvider`（降级）/ `LiteLlmEmbeddingProvider`。 */
  provider: string;
  task?: string;
  model?: string;
  dimensions?: number;
  /** `verified` = 启动时真调过一次；`host_managed` = 由宿主保证，未自检。 */
  readiness: 'verified' | 'host_managed';
}

/**
 * 31 个受能力门控的记忆操作（`BMemoryCapabilities.operations`，键集逐字对齐后端接口声明）。
 *
 * ⚠️ 键名与 RPC 方法名并非一一对应：`get_agent_persona` 对应 `memory.getAgent`，
 * `publish_skill` 对应 `memory.publishSkillToMarket`；`memory.getCapabilities` 自身没有键。
 *
 * 可用性规则（b-memory-backend-service.ts `getCapabilities()`）：
 * - 无条件 available：list_agents / get_agent_persona / list_experiences / list_skills /
 *   list_maintenance / approve_skill / reject_skill / promote_skills
 * - 需 repository + embedding：search_memory / market_search
 * - 需生命周期端口：retire_agent / retirement_scan / create_agent / update_agent / delete_agent
 * - 其余需 repository
 */
export interface MemoryOperations {
  list_agents: MemoryOperationCapability;
  /** 对应 `memory.getAgent`（后端键名沿用旧的 persona 语义）。 */
  get_agent_persona: MemoryOperationCapability;
  list_experiences: MemoryOperationCapability;
  list_skills: MemoryOperationCapability;
  list_maintenance: MemoryOperationCapability;
  promote_skills: MemoryOperationCapability;
  approve_skill: MemoryOperationCapability;
  reject_skill: MemoryOperationCapability;
  update_persona: MemoryOperationCapability;
  regenerate_persona: MemoryOperationCapability;
  rate_task: MemoryOperationCapability;
  get_buffer_state: MemoryOperationCapability;
  get_pending_buffer: MemoryOperationCapability;
  retry_extraction: MemoryOperationCapability;
  search_memory: MemoryOperationCapability;
  market_search: MemoryOperationCapability;
  market_import: MemoryOperationCapability;
  retire_agent: MemoryOperationCapability;
  retirement_scan: MemoryOperationCapability;
  create_agent: MemoryOperationCapability;
  update_agent: MemoryOperationCapability;
  delete_agent: MemoryOperationCapability;
  create_skill: MemoryOperationCapability;
  update_skill: MemoryOperationCapability;
  delete_skill: MemoryOperationCapability;
  /** 对应 `memory.publishSkillToMarket`。 */
  publish_skill: MemoryOperationCapability;
  update_experience: MemoryOperationCapability;
  delete_experience: MemoryOperationCapability;
  get_overview: MemoryOperationCapability;
  list_pending_reviews: MemoryOperationCapability;
  list_experiences_by_source_task: MemoryOperationCapability;
}

/** `MemoryOperations` 的键名联合，用于按名字做能力判定。 */
export type MemoryOperationName = keyof MemoryOperations;

/**
 * `memory.getCapabilities` 的能力清单（`BMemoryCapabilities`）。
 *
 * `schema_version` 刻意钉死成字面量：后端升版时这里必须编译报错，而不是悄悄漏读新字段。
 * v1 → v2 的变化是新增了 `skill_review` 块，并把 operations 补齐到 31 个键。
 */
export interface MemoryCapabilities {
  schema_version: 'newide.b-memory-capabilities.v2';
  embedding: MemoryEmbeddingRuntime;
  /** `auto_approve` = 晋升出来的技能直接 approved（NEWIDE_B_SKILL_AUTO_APPROVE），无需人工审核队列。 */
  skill_review: {
    mode: 'manual' | 'auto_approve';
  };
  operations: MemoryOperations;
}

// ── Agent Board 视图（memory.listAgents / getAgent / createAgent / updateAgent） ──

/** 角色画像（`PersonaDefSchema`）；`memory.updatePersona` / `regeneratePersona` 直接返回它。 */
export interface RpcPersonaView {
  role_id: string;
  /** 每次 PATCH 或重生成 +1。 */
  version: number;
  summary: string;
  skills_overview: string;
  experience_coverage: string;
  recent_performance: string;
  notes: string;
  generated_at: string;
}

/** Agent 原始指标（`AgentMetricsSchema`），落库持久化。 */
export interface RpcAgentMetrics {
  role_id: string;
  total_tasks: number;
  tasks_bid: number;
  tasks_won: number;
  tasks_completed: number;
  tasks_succeeded: number;
  tasks_partial: number;
  tasks_failed: number;
  skill_count: number;
  experience_count: number;
  imported_skill_count: number;
  promoted_skill_count: number;
  /** 所有经验的平均置信度（0~1）。 */
  avg_confidence: number;
  token_cost_total: number;
  first_task_at?: string;
  last_task_at?: string;
  last_won_at?: string;
  persona_version: number;
  /** Persona 漂移度（0~1），越高表示当前表现与画像描述差异越大。 */
  persona_drift?: number;
  persona_stable_since?: string;
  /** 以下三个时间戳是退休三重门控的冷却状态，不是业务时间。 */
  last_retirement_scan_at?: string;
  last_persona_drift_eval_at?: string;
  last_llm_eval_at?: string;
}

/** 派生指标（`DerivedMetrics`），后端每次 getAgent 现算，不落库。 */
export interface RpcDerivedMetrics {
  /** tasks_succeeded / tasks_completed，completed=0 时为 0。 */
  success_rate: number;
  /** tasks_won / tasks_bid，bid=0 时为 0。 */
  bid_win_rate: number;
  /** experience_count / total_tasks。 */
  experience_density: number;
  /** skill_count / experience_count。 */
  skill_density: number;
  /** 1 / (1 + 距上次任务天数 / 14)；从未接过任务按 30 天算。 */
  activity_score: number;
}

export interface RpcAgentBoardListItem {
  role_id: string;
  name: string;
  status: string;
  tags?: string[];
  skill_count: number;
  experience_count: number;
  persona_summary: string;
}

export interface RpcAgentBoardAgentView extends Omit<RpcAgentBoardListItem, 'persona_summary'> {
  persona: RpcPersonaView;
  metrics: { raw: RpcAgentMetrics; derived: RpcDerivedMetrics };
  created_at: string;
}

// ── Skill / Experience 视图 ──

/** 置信度变更历史条目（`ConfidenceHistoryEntrySchema`）。 */
export interface RpcConfidenceHistoryEntry {
  value: number;
  updated_at: string;
  /** 变更来源，如 `manual_adjustment`、`user_rating:resolved`。 */
  reason: string;
}

export interface RpcSkillView {
  id: string;
  description: string;
  content: string;
  version: string;
  review_status: string;
  sub_skills?: string[];
  tags: string[];
  promoted_from?: string;
  promoted_at: string;
  agent_id: string;
  /**
   * 技能谱系的根创建者。技能迁入市场池、或被别的 Agent 引入时沿袭原创建者。
   * ⚠️ `SkillView` 不投影 `imported_from`，所以从这里看不出某个副本引自哪条市场技能。
   */
  origin_agent_id?: string;
  imported_by?: string[];
  linked_negative_exp?: string[];
  market_status?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * 原始技能记录（`SkillRecordSchema`）。只有 3 个方法把它整个吐到线上：
 * `memory.marketSearch`、`memory.approveSkill`、`memory.rejectSkill`。
 * 与 `RpcSkillView` 的差别是多带了 `description_embedding`（可能很长）与 `imported_from`。
 */
export interface RpcSkillRecord extends RpcSkillView {
  /** 描述文本的向量嵌入，维度取决于 embedding provider。展示层不要渲染。 */
  description_embedding: number[];
  /** 由市场引入时指向源技能 ID（用于溯源与幂等）。 */
  imported_from?: string;
}

export interface RpcExperienceView {
  id: string;
  description: string;
  content: string;
  confidence: number;
  tags: string[];
  agent_id: string;
  promoted_to?: string;
  assumptions?: string[];
  confidence_history: RpcConfidenceHistoryEntry[];
  referenced_count: number;
  last_referenced_at?: string;
  source_task_id: string;
  source_driver: string;
  source_user_rating?: string;
  type: string;
  created_at: string;
  updated_at: string;
}

// ── memory.searchMemory ──

/** 语义检索命中的技能：`SkillView` + 余弦相似度。 */
export interface RpcSkillSearchHit extends RpcSkillView {
  /** 与 query 的余弦相似度，理论区间 [-1,1]，实测集中在 0~1。 */
  similarity: number;
}

/** 语义检索命中的经验：`ExperienceView` + 余弦相似度。 */
export interface RpcExperienceSearchHit extends RpcExperienceView {
  similarity: number;
}

/**
 * `memory.searchMemory` 的 result **本体**：skills / experiences 直接挂在 result 顶层，
 * 没有额外信封键（不同于其他方法的 `{ skills: … }` 包一层）。
 */
export interface RpcMemorySearchResult {
  skills: RpcSkillSearchHit[];
  experiences: RpcExperienceSearchHit[];
}

/** `memory.searchMemory` 的可选检索参数（top_k 默认 5，由服务层兜底）。 */
export interface MemorySearchOptions {
  top_k?: number;
  min_similarity?: number;
  /** 只有显式传 false 才会抑制该类结果。 */
  include_skills?: boolean;
  include_experiences?: boolean;
}

// ── memory.getOverview ──

/** 全局记忆总览（services/memory-overview.ts `MemoryOverview`）。 */
export interface RpcMemoryOverview {
  agents: {
    total: number;
    /** 只包含计数非 0 的状态键。 */
    by_status: Partial<Record<MemoryAgentStatus, number>>;
  };
  skills: {
    total: number;
    /** review_status='pending' 的技能数。 */
    pending_review: number;
    /** market_status='available' 的技能数；`retired_unique` 不计入。 */
    in_market: number;
  };
  experiences: { total: number };
  buffer: {
    /** 全部 Agent 的 pending buffer 总数。 */
    pending: number;
    /** 全部 Agent 的死信 buffer 总数。 */
    dead_letters: number;
  };
  quality: {
    /** 跨 Agent 所有经验的简单平均置信度，无经验时为 0。 */
    avg_confidence: number;
  };
}

// ── Buffer（memory.getBufferState / getPendingBuffer / retryExtraction） ──

/** 缓冲区元数据（`BufferMetaSchema`）。 */
export interface RpcBufferMeta {
  role_id: string;
  pending_count: number;
  last_extraction_at?: string;
  last_extraction_report_count?: number;
  last_extraction_experiences_created?: number;
  /** 当前写入游标，下一个 seq = cursor + 1。 */
  cursor: number;
  total_processed: number;
  total_dead_letters: number;
  total_cleaned?: number;
}

/** 死信条目（`DeadLetterEntry`）——重试流程要展示的失败原因就在这里。 */
export interface RpcDeadLetterEntry {
  seq: number;
  task_id: string;
  /** 提取失败原因，`markBufferDeadLetter` 时记录，可能缺失。 */
  reason?: string;
  failed_at: string;
}

/**
 * `memory.getBufferState` 的 result.state（后端为匿名内联类型，没有具名导出）。
 * `dead_letter_seqs` 与 `dead_letters` 内容重叠，后端两个都发。
 */
export interface RpcBufferState {
  meta: RpcBufferMeta;
  pending_seqs: number[];
  dead_letter_seqs: number[];
  dead_letters: RpcDeadLetterEntry[];
}

/** Driver 6 字段报告中的产出制品。 */
export interface RpcDriverReturnArtifact {
  type: string;
  path: string;
  summary: string;
}

/** 决策路径记录：决策点 → 可选方案 → 最终选择 + 理由。 */
export interface RpcDriverReturnDecision {
  point: string;
  options: string[];
  chosen: string;
  reason: string;
}

/** 阻塞项及其解决尝试。 */
export interface RpcDriverReturnBlocker {
  blocker: string;
  attempts: string[];
  resolution: string;
  resolved: boolean;
}

/** 本次任务引用过的经验及其实际效果。 */
export interface RpcDriverReturnReferencedExperience {
  experience_id: string;
  applied: boolean;
  effectiveness: MemoryEffectiveness;
  note: string;
}

/** 执行中做出的假设及其出错后果。 */
export interface RpcDriverReturnAssumption {
  assumption: string;
  risk_if_wrong: string;
}

/** Driver 6 字段结构化报告（`DriverReturnSchema`），经验提取的原材料之一。 */
export interface RpcDriverReturn {
  artifacts: RpcDriverReturnArtifact[];
  summary: string;
  effectiveness?: MemoryEffectiveness;
  decisions: RpcDriverReturnDecision[];
  blockers: RpcDriverReturnBlocker[];
  referenced_experiences: RpcDriverReturnReferencedExperience[];
  assumptions: RpcDriverReturnAssumption[];
}

/** 缓冲区快照（`BufferSnapshotSchema`）：一条待提取的 Driver 报告。 */
export interface RpcBufferSnapshot {
  task_id: string;
  task_description: string;
  /** 已评分时才有；`memory.rateTask` 会回填仍 pending 的这一条。 */
  user_rating?: MemoryUserRating;
  driver_return: RpcDriverReturn;
  source_task_id: string;
  source_driver: string;
  /** 配对的 context_{seq}.json；缺失表示上下文清理失败，提取降级为只用 driver_return。 */
  context_snapshot_ref?: string;
  received_at: string;
  retry_count: number;
  extraction_status: MemoryExtractionStatus;
}

/** 清理后保留的 Driver 调用记录。 */
export interface RpcAgentContextDriverCall {
  call_id: string;
  driver_id: string;
  /** 指向对应 DriverReturn，如 report_{seq}.json。 */
  driver_return_ref: string;
}

/** Agent 顶层上下文快照（`AgentContextSnapshotSchema`），与 BufferSnapshot 成对落盘。 */
export interface RpcAgentContextSnapshot {
  snapshot_id: string;
  source_task_id: string;
  agent_id: string;
  thinking_trace: string;
  planning_trace: string;
  driver_calls: RpcAgentContextDriverCall[];
  cleaned_at: string;
  original_token_count: number;
  cleaned_token_count: number;
  /** cleaned_token_count / original_token_count。 */
  compression_ratio: number;
}

/**
 * `memory.getPendingBuffer` 的 result.buffer。
 *
 * ⚠️ 线上键名是驼峰的 `agentContext`，不是 snake_case。后端 `MemoryMethodsService` 与
 * `BMemoryBackendService` 都把它声明成 `agent_context`，但值是从
 * `BufferRepository.getPendingBuffer` 原样透传的，两个适配器（file / in-memory）都发
 * `agentContext`；TS 因为可选属性的多余属性检查不作用于非字面量返回值而没咬住。
 * 以实际线上键为准，这里不跟着后端的错误声明走。
 *
 * seq 不存在 / 已处理 / 已进死信时后端返回 undefined，`JSON.stringify` 会把整个键丢掉，
 * 于是 result 序列化成 `{}` —— RPC 映射里的 `buffer` 必须是可选的。
 */
export interface RpcPendingBuffer {
  snapshot: RpcBufferSnapshot;
  agentContext?: RpcAgentContextSnapshot;
}

// ── 退休（memory.retirementScan / retireAgent） ──

/** 单层退休评估结果（`RetirementEvaluation`）。 */
export interface RpcRetirementEvaluation {
  action: MemoryRetirementAction;
  /** 该层对自己结论的置信度（0~1）。 */
  confidence: number;
  reasons: string[];
  /** 第二层写回的 Persona 漂移分（0~1）。 */
  persona_drift?: number;
  /** 第三层评估的技能市场可替代率（0~1）。 */
  market_replaceability?: number;
  /** 第三层评估的经验可恢复率（0~1）。 */
  experience_recoverability?: number;
}

/** 逐层执行记录（`RetirementLayerOutcome`）。 */
export interface RpcRetirementLayerOutcome extends RpcRetirementEvaluation {
  layer: MemoryRetirementLayer;
  /** true 表示该层因冷却期被跳过，没有真的评估，沿用上一层结论。 */
  skipped?: boolean;
}

/**
 * 一次三重门控扫描的结果（`RetirementScanResult`）。
 * `memory.retirementScan` 的 result.scans **永远是数组**，即使只扫一个 role_id。
 * 纯建议：扫描本身不会退休任何 Agent。
 */
export interface RpcRetirementScanResult {
  scan_id: string;
  role_id: string;
  scanned_at: string;
  action: MemoryRetirementAction;
  confidence: number;
  reasons: string[];
  layers: RpcRetirementLayerOutcome[];
  /** 仅 action='retire' 时给出，可直接喂给 `memory.retireAgent` 的 reason。 */
  suggested_reason?: MemoryRetiredReason;
  /** 仅 scanAll 容错路径会写：该 Agent 扫描失败，此条是占位的 keep/confidence:0 结果。 */
  error?: string;
}

/** 退休时的资产处置统计（`RetireAssetDisposition`）。 */
export interface RpcRetireAssetDisposition {
  /** 迁入市场池 `__market__` 的技能数（被引用过的置 available，无人引用的置 retired_unique）。 */
  skills_retained: number;
  /** 直接删除的技能数（review_status='rejected'）。 */
  skills_discarded: number;
  /** 置信度 ≥ 0.7 而归档保留的经验数。 */
  experiences_retained: number;
  experiences_discarded: number;
}

/** `memory.retireAgent` 的 result.retire（`RetireResult`）。重复退休是幂等的，返回全 0 处置。 */
export interface RpcRetireResult {
  role_id: string;
  status: 'retired';
  retired_at: string;
  retired_reason: MemoryRetiredReason;
  asset_disposition: RpcRetireAssetDisposition;
  /** 仅 replacement 为 clean_slate / seeded_slate 时出现，形如 `${role_id}__replacement`。 */
  replacement_role_id?: string;
}

/** `memory.retireAgent` 的可选项（reason 默认 manual，replacement 默认 none）。 */
export interface MemoryRetireOptions {
  reason?: MemoryRetiredReason;
  replacement?: MemoryReplacementStrategy;
}

// ── 技能市场（memory.marketSearch / marketImport） ──

/** `memory.marketSearch` 的检索参数（top_k 默认 10，由服务层兜底）。 */
export interface MemoryMarketSearchQuery {
  query: string;
  top_k?: number;
  min_similarity?: number;
  /** 通常传自己，避免推荐自家技能。 */
  exclude_agent_id?: string;
}

/**
 * `memory.marketImport` 的 result.import（`MarketImportResult`）。
 * 信封键就是保留字 `import`。两个成员都是原始 `SkillRecord`，带 `description_embedding`。
 */
export interface RpcMarketImportResult {
  /** 引入后的副本：新 UUID，agent_id 为引入方，imported_from 指向源技能。 */
  imported: RpcSkillRecord;
  /** 更新后的源技能：imported_by 已追加引入方。 */
  source: RpcSkillRecord;
  /** false 表示幂等命中 —— 该 Agent 之前已引入过这条技能，没有新建副本。 */
  created: boolean;
}

// ── 评分（memory.rateTask） ──

/** `memory.rateTask` 的 result.rating（`UserRatingResult`）。 */
export interface RpcUserRatingResult {
  /** 被改写置信度的经验条数（按 source_task_id 匹配）。 */
  updated_experiences: number;
  /** 是否把评分写进了仍处于 pending 的缓冲区快照；没有匹配的 pending 不算错误。 */
  buffer_updated: boolean;
}

// ── 写入侧补丁与过滤器（RPC 参数用） ──

/** `memory.createAgent` 的入参（`CreateAgentSpec`）。role_id 重复会被后端拒绝。 */
export interface MemoryCreateAgentSpec {
  role_id: string;
  name: string;
  tags?: string[];
  /** 生成初始画像摘要的种子文本。 */
  persona_seed?: string;
  /** 限制 Agent 行为范围的约束条目。 */
  constraints?: string[];
}

/** `memory.updateAgent` 的补丁（`AgentMetaPatch`）。两个字段至少要给一个，否则 -32602。 */
export interface MemoryAgentMetaPatch {
  name?: string;
  tags?: string[];
}

/**
 * `memory.updatePersona` 的补丁（`PersonaPatch`）。至少给一个字段，否则 -32602。
 * 这几个字段刻意允许空串（后端 zod 没加 min(1)），传 '' 就是清空该段文字。
 */
export interface MemoryPersonaPatch {
  summary?: string;
  skills_overview?: string;
  experience_coverage?: string;
  recent_performance?: string;
  notes?: string;
}

/** `memory.createSkill` 的入参（`CreateSkillInput`）。version 默认 '1.0.0'。 */
export interface MemoryCreateSkillInput {
  role_id: string;
  description: string;
  content: string;
  tags?: string[];
  version?: string;
}

/**
 * `memory.updateSkill` 的 PATCH 补丁（`SkillWritePatch`）。至少给一个字段，否则 -32602。
 * 改 description 会清空 description_embedding，由仓库重算。
 */
export interface MemorySkillWritePatch {
  description?: string;
  content?: string;
  tags?: string[];
  market_status?: MemoryMarketStatusPatch;
}

/**
 * `memory.updateExperience` 的 PATCH 补丁（`ExperienceWritePatch`）。至少给一个字段。
 * 改 confidence 会向 confidence_history 追加一条 reason='manual_adjustment'，并重算 avg_confidence。
 */
export interface MemoryExperienceWritePatch {
  description?: string;
  content?: string;
  tags?: string[];
  /** 0~1。 */
  confidence?: number;
}

/** `memory.listSkills` 的过滤 / 分页参数（`SkillListFilter`）。 */
export interface MemorySkillListFilter {
  /** pending / approved / rejected，后端不做枚举校验。 */
  review_status?: string;
  /** tags 精确包含该标签。 */
  tag?: string;
  /** 对 description + content 做不区分大小写的子串匹配，不走向量。 */
  keyword?: string;
  /** 默认 0。 */
  offset?: number;
  /** 默认不限。 */
  limit?: number;
}

/** `memory.listExperiences` 的过滤 / 分页参数（`ExperienceListFilter`）。 */
export interface MemoryExperienceListFilter {
  /** positive / negative，后端不做枚举校验。 */
  type?: string;
  /** 置信度下限，含端点。 */
  confidence_min?: number;
  /** 置信度上限，含端点。 */
  confidence_max?: number;
  tag?: string;
  keyword?: string;
  offset?: number;
  limit?: number;
}

/** `memory.deleteAgent` / `deleteSkill` / `deleteExperience` 的统一 result。 */
export interface RpcMemoryDeleted {
  deleted: true;
}

// ── 维护证据（memory.listMaintenance / promoteSkills / retryExtraction） ──

export interface MemoryMaintenanceEvidence {
  maintenance_ref: string;
  kind: 'experience_extraction' | 'skill_promotion';
  status: 'scheduled' | 'running' | 'completed' | 'skipped' | 'failed';
  role_id: string;
  task_id?: string;
  run_id?: string;
  buffer_seq?: number;
  requested_by?: string;
  /** 后端声明为 unknown[]，实测是 ExperienceRecord 形状；消费处自行收窄。 */
  experiences: unknown[];
  /** 后端声明为 unknown[]，实测是 SkillRecord 形状；消费处自行收窄。 */
  skills: unknown[];
  warnings: string[];
  error?: string;
  evidence_uri?: string;
  created_at: string;
  completed_at: string;
  /** 这是 core 的 SCHEMA_VERSION，不是记忆模块自己的版本字面量。 */
  schema_version: string;
}

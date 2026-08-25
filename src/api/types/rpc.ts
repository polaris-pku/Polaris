/**
 * BCD 后端 RPC 契约镜像（**最新**：`frontend-workflow.v0.1`）。
 *
 * 逐字对齐 `packages/newide-bcd/src/protocol/{run-event,run-snapshot}.ts`。
 * 这是前端与后端之间**唯一活的契约** —— 后端改了这里就要跟着改，`tsc` 会咬住。
 *
 * 注意与 ./snapshot.ts 的区别：那个建模的是 BCD 落盘的 `frontend-snapshot.json`
 * （`coordinator.frontend_run_snapshot.v0`，供 mock 剧本回放用）；本文件建模的是
 * `run.getSnapshot` 通过 RPC 实时返回的形状。两者不同，不要混用。
 */
import type { ArtifactContentResult, ArtifactGetContentParams } from './artifact';
import type {
  CouncilAuction,
  CouncilFatalError,
  CouncilImplementation,
  CouncilOutcome,
  CouncilParticipant,
  CouncilPhase,
  CouncilVerdict,
  RunMarketSelection,
} from './council';
import type {
  PingResult,
  SystemCapabilities,
  SystemLiveness,
  SystemReadiness,
  SystemSchemaManifest,
  SystemVersion,
} from './system';
import type { TaskCreateParams, TaskSnapshot, TaskSubscribeResult } from './task';
import type {
  MemoryAgentMetaPatch,
  MemoryCapabilities,
  MemoryCreateAgentSpec,
  MemoryCreateSkillInput,
  MemoryExperienceListFilter,
  MemoryExperienceWritePatch,
  MemoryMaintenanceEvidence,
  MemoryMarketSearchQuery,
  MemoryPersonaPatch,
  MemoryRetireOptions,
  MemorySearchOptions,
  MemorySkillListFilter,
  MemorySkillWritePatch,
  MemoryUserRating,
  RpcAgentBoardAgentView,
  RpcAgentBoardListItem,
  RpcBufferState,
  RpcExperienceView,
  RpcMarketImportResult,
  RpcMemoryDeleted,
  RpcMemoryOverview,
  RpcMemorySearchResult,
  RpcPendingBuffer,
  RpcPersonaView,
  RpcReindexResult,
  RpcRetireResult,
  RpcRetirementScanResult,
  RpcSkillRecord,
  RpcSkillView,
  RpcUserRatingResult,
} from './memory';
import type {
  MailboxAckParams,
  MailboxDelivery,
  MailboxEnvelope,
  MailboxInboxParams,
  MailboxMessage,
  MailboxReplyParams,
  MailboxSendParams,
} from './mailbox';

/** run.event 的来源方向（由 event.type 前缀推导，见后端 projectRunEventSource）。 */
export type RunEventSource = 'coordinator' | 'agent' | 'driver' | 'memory' | 'gate' | 'council';

/** 后端推给前端的单条流程事件。`sequence` 单调递增，用于去重与排序。 */
export interface RunEvent {
  event_id: string;
  sequence: number;
  run_id: string;
  task_id: string;
  type: string;
  source: RunEventSource;
  created_at: string;
  payload: Record<string, unknown>;
  payload_ref?: string;
  schema_version: string;
}

/** 协调器任务态（比前端展示词表更细，映射见 ../map.ts）。 */
export type RpcTaskStatus =
  | 'created'
  | 'triaged'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'waiting_input'
  | 'waiting_help'
  | 'pending_gate'
  | 'pending_council'
  | 'reviewing'
  | 'blocked'
  | 'escalated'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunMode = 'single_agent' | 'council';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStage = 'executing' | 'council' | 'delivery' | 'intervention';

/** 流程图节点态（N0–N18 固定 19 项）。 */
export interface RunNodeStatus {
  code: string;
  status: 'pending' | 'active' | 'done' | 'blocked' | 'updated';
  event_type?: string;
  event_id?: string;
  [key: string]: unknown;
}

export interface RunError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * run.getSnapshot 的返回。
 *
 * **形状是双态的**：只有跑到足够远的 run 才带 contract_version / task / run / flow /
 * delivery_report / links；早期被取消的 run 只有瘦字段。用 `isFrontendWorkflowV01`
 * 守卫后再访问那些字段。
 */
export interface RunSnapshot {
  contract_version?: 'frontend-workflow.v0.1';
  schema_version: string;
  run_id: string;
  task_id: string;
  mode: RunMode;
  status: RunStatus;
  quality?: Record<string, unknown>;
  current: {
    stage: RunStage;
    active_node_code: string;
    task_status?: string;
  };
  task?: {
    task_id: string;
    status: RpcTaskStatus;
    spec: string;
    completion_criteria: string[];
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    affected_paths: string[];
    role_id?: string;
    budget?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    schema_version: string;
  };
  run?: {
    run_id: string;
    task_id: string;
    status: string;
    mode: RunMode;
    session_id?: string;
    event_ids: string[];
    started_at?: string;
    completed_at?: string;
    checkpoint_id?: string;
  };
  flow?: {
    active_node_code: string;
    node_statuses: RunNodeStatus[];
  };
  delivery_report?: {
    worktree_path?: string;
    files_written: string[];
    changed_files?: string[];
    artifacts_materialized: number;
    outcome?: 'completed_files' | 'completed_response' | 'failed';
    response?: string;
    session_id?: string;
    tool_events?: Record<string, unknown>[];
    quality?: Record<string, unknown>;
  };
  links?: Record<string, unknown>;
  timeline: RunEvent[];
  agent_runs: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  gates: Record<string, unknown>[];
  /**
   * 主执行席位的选人结果指纹（来自 `market.selected`）。
   * 6 个字段要么齐全要么整块不存在，不会有「半块」；竞标**过程**在 `council.auctions` 里。
   */
  market?: RunMarketSelection;
  /**
   * council 模式才有。
   *
   * ⚠️ **下面这些嵌套结构的形状是投影器定的，不是 schema 定的**。后端
   * `protocol/run-snapshot.ts` 里 `auctions` / `participants` / `proposals` / `reviews` /
   * `synthesis` / `implementation` / `output` / `result` / `fatal_error` 全是
   * `z.record(z.string(), z.unknown())` —— 字段级根本没过校验。这里写的具名类型
   * 描述的是 `app/task-run-snapshot-projector.ts` 实际投出来的形状，属于「后端声称会发什么」，
   * **不是运行时保证**。消费方仍要逐字段防御性取值（用 lib/councilBoard.ts 里的
   * asRecord / str / strList），不能因为 tsc 过了就当字段一定在。
   *
   * ⚠️ `can_create_merge_authorization` 在当前后端**恒为 false** —— Council 由
   * proposer/reviewer/synthesis 几个 agent 角色自己裁决，**没有人类回写通道**。
   * 前端的裁决交互目前只改本地状态，见 ../transport.ts 里的扩展位说明。
   */
  council?: {
    enabled: true;
    status: RunStatus;
    /** 本轮 Council 的实例 id；投影器从 completed / decision / participants.selected 里取第一个非空值。 */
    council_run_id?: string;
    /** 投影器倒着扫事件推出来的当前阶段；一条 council.* 事件都没有时整个键不出现。 */
    phase?: CouncilPhase;
    /** 议题正文 —— `council.started` 回显的 task spec，可能很长。 */
    subject?: string;
    /** 已见取值 'classic' / 'adaptive_lead' / 'plan_first'；后端声明为裸 string，别做穷尽 switch。 */
    strategy?: string;
    /** plan_first 策略产出 plan，其余策略产出 implementation。 */
    artifact_mode?: 'implementation' | 'plan';
    /**
     * 席位竞标过程：由 `market.auction.started` 与 `market.auction.completed` 按
     * auction_id 合并而来。投影器总会给这个键（没跑竞标就是空数组），
     * 但 schema 允许缺省，所以仍按可选读。
     */
    auctions?: CouncilAuction[];
    decision_id?: string;
    /**
     * 与契约镜像锚在同一个类型上（见 ./council 的 `CouncilVerdict`）——
     * 后端改裁决词表，这里和消费它的 UI 词表会**一起**编译不过。
     *
     * 边界仍然是不可信 JSON：后端 schema 这里写的是裸 `z.string()`，没收进枚举。
     * 所以消费方（pages/CouncilBoard.tsx）对词表外的值保留运行时兜底，不崩在陌生字符串上。
     */
    verdict?: CouncilVerdict;
    decision_mode?: string;
    /** schema 里有这个键，但当前投影器从不填它 —— 实测永远是 undefined。 */
    selected_proposal_id?: string;
    selected_artifact_refs: string[];
    required_next_actions: string[];
    blocked_by: string[];
    can_create_merge_authorization: boolean;
    /** 席位与真实 Agent 的绑定；优先取 `council.completed`，取不到才回落 participants.selected。 */
    participants?: CouncilParticipant[];
    /**
     * `proposals` / `reviews` / `synthesis` / `output` 的整体形状后端没定死，
     * 投影器把事件 payload 原样搬过来，所以保持 `Record<string, unknown>`，
     * 由消费方逐字段防御性取值 —— 只给形状稳定的结构收紧。
     */
    proposals?: Record<string, unknown>[];
    reviews?: Record<string, unknown>[];
    synthesis?: Record<string, unknown>;
    /** 只有 plan_first 才有：主 Agent 按最终 Plan 实施的那一段。 */
    implementation?: CouncilImplementation;
    output?: Record<string, unknown>;
    /**
     * `council.completed` 的 payload.result（后端 `CouncilResult`），与 ./task 里
     * `TaskSnapshot.council.result` 同形。`quality` 仅审计用，不是完成判定依据。
     */
    result?: {
      quality: 'verified' | 'best_effort';
      final_artifact_ref: string;
      final_artifact_sha256: string;
      warnings: string[];
      unmet_criteria: string[];
      verification_refs: string[];
      decision_record_ref: string;
    };
    outcome?: CouncilOutcome;
    /** 出现即代表 Council 阶段抛异常终止，`phase` 同时会是 'failed'。 */
    fatal_error?: CouncilFatalError;
  };
  checkpoint?: Record<string, unknown>;
  errors: RunError[];
  final_output?: {
    status: 'completed' | 'failed' | 'cancelled';
    artifact_refs: string[];
    files_written: string[];
    changed_files?: string[];
    outcome?: 'completed_files' | 'completed_response' | 'failed';
    response?: string;
    session_id?: string;
    tool_events?: Record<string, unknown>[];
    quality?: Record<string, unknown>;
  };
}

/** 完整形态的快照（带 task/run/flow/delivery_report/links）。 */
export type FrontendWorkflowV01Snapshot = RunSnapshot &
  Required<Pick<RunSnapshot, 'task' | 'run' | 'flow' | 'delivery_report' | 'links'>> & {
    contract_version: 'frontend-workflow.v0.1';
  };

/** 瘦快照 → 完整快照的守卫（对齐后端 isFrontendWorkflowV01Snapshot）。 */
export function isFrontendWorkflowV01(
  snapshot: RunSnapshot,
): snapshot is FrontendWorkflowV01Snapshot {
  return snapshot.contract_version === 'frontend-workflow.v0.1';
}

// ── RPC 方法签名 ──

export interface RunCreateParams {
  prompt: string;
  workspace_path: string;
  session_id?: string;
  mode?: RunMode;
  project_id?: string;
  client_task_id?: string;
  title?: string;
  memory_ablation?: 'B0' | 'B1' | 'B2' | 'B3';
}

export interface RunCreateResult {
  run_id: string;
  task_id: string;
  status: 'running';
}

export interface RpcMethodMap {
  'system.ping': { params: Record<string, never>; result: PingResult };
  'system.liveness': { params: Record<string, never>; result: SystemLiveness };
  'system.readiness': { params: Record<string, never>; result: SystemReadiness };
  'system.capabilities': {
    params: { require?: string[] };
    result: SystemCapabilities;
  };
  'system.version': { params: Record<string, never>; result: SystemVersion };
  'system.schema': { params: Record<string, never>; result: SystemSchemaManifest };

  'task.create': { params: TaskCreateParams; result: TaskSnapshot };
  'task.get': { params: { task_id: string }; result: TaskSnapshot };
  'task.list': { params: Record<string, never>; result: { tasks: TaskSnapshot[] } };
  'task.cancel': { params: { task_id: string }; result: TaskSnapshot };
  'task.resume': { params: { task_id: string }; result: TaskSnapshot };
  'task.startCouncil': { params: { task_id: string }; result: TaskSnapshot };
  'task.subscribe': {
    params: { task_id: string; after_event_id?: string };
    result: TaskSubscribeResult;
  };
  'task.unsubscribe': {
    params: { task_id: string };
    result: { unsubscribed: true };
  };

  'run.create': { params: RunCreateParams; result: RunCreateResult };
  'run.getSnapshot': { params: { run_id: string }; result: RunSnapshot };
  'run.list': { params: Record<string, never>; result: { runs: Record<string, unknown>[] } };
  'run.cancel': { params: { run_id: string }; result: { cancelled: true } };
  'run.restart': {
    params: { run_id: string };
    result: {
      run_id: string;
      task_id: string;
      restarted_from_run_id: string;
      status: 'running';
    };
  };
  'run.subscribe': { params: { run_id: string }; result: { subscribed: true } };
  'run.unsubscribe': { params: { run_id: string }; result: { unsubscribed: true } };

  /**
   * 制品正文读取。老后端没注册这条方法会回 -32601，调用方要把它当「后端太旧」降级，
   * 不是「制品不存在」。两个错误码（-32015 / -32016）的 data 形状见 ./artifact
   * 的 `ArtifactContentErrorData`。
   */
  'artifact.getContent': { params: ArtifactGetContentParams; result: ArtifactContentResult };

  // ── memory.* ──
  // 逐条对齐 packages/newide-bcd/src/rpc/memory-methods.ts 里 dispatcher.register 的返回体。
  // 每个 result 都套了**具名信封**（{ agents } / { skill } / { deleted: true } / { maintenance } …），
  // 只有 memory.searchMemory 是裸对象。信封键写错在运行时只会拿到 undefined，tsc 咬不住，
  // 所以这里的键名必须逐字抄后端。
  'memory.getCapabilities': {
    params: Record<string, never>;
    result: { capabilities: MemoryCapabilities };
  };
  'memory.listAgents': {
    params: { status?: string };
    result: { agents: RpcAgentBoardListItem[] };
  };
  'memory.getAgent': {
    params: { role_id: string };
    result: { agent: RpcAgentBoardAgentView };
  };
  'memory.listSkills': {
    params: { role_id: string } & MemorySkillListFilter;
    result: { skills: RpcSkillView[] };
  };
  'memory.listExperiences': {
    params: { role_id: string } & MemoryExperienceListFilter;
    result: { experiences: RpcExperienceView[] };
  };
  /** 唯一没有信封的 memory 方法：直接回 { skills, experiences }，每项附 similarity。 */
  'memory.searchMemory': {
    params: { role_id: string; query: string } & MemorySearchOptions;
    result: RpcMemorySearchResult;
  };
  'memory.getOverview': {
    params: Record<string, never>;
    result: { overview: RpcMemoryOverview };
  };
  'memory.listPendingReviews': {
    params: Record<string, never>;
    result: { skills: RpcSkillView[] };
  };
  'memory.listExperiencesBySourceTask': {
    params: { task_id: string };
    result: { experiences: RpcExperienceView[] };
  };
  /**
   * 重算存量 `description_embedding`。不传 `role_id` 是全量（含市场池）；
   * `force` 不传时只补「为空或维度不匹配」的记录，同维度换模型必须显式传 true。
   */
  'memory.reindex': {
    params: { role_id?: string; force?: boolean };
    result: { reindex: RpcReindexResult };
  };
  'memory.listMaintenance': {
    params: { role_id?: string };
    result: { maintenance: MemoryMaintenanceEvidence[] };
  };
  'memory.promoteSkills': {
    params: { role_id: string; requested_by?: string };
    result: { maintenance: MemoryMaintenanceEvidence };
  };
  /**
   * 显式晋升一条经验为待审核技能。后端只接受 **positive 且尚未晋升** 的经验，
   * 其余情况抛错（`Only positive experiences can be promoted` /
   * `Experience already promoted to skill`）。
   */
  'memory.promoteExperience': {
    params: { role_id: string; experience_id: string };
    result: { skill: RpcSkillView };
  };
  /** 检索范围仅市场池 `__market__`；未上架的技能搜不到。 */
  'memory.marketSearch': {
    params: MemoryMarketSearchQuery;
    result: { skills: RpcSkillRecord[] };
  };
  /** 信封键是保留字 `import`，消费处要写成 `result.import`。 */
  'memory.marketImport': {
    params: { role_id: string; source_skill_id: string };
    result: { import: RpcMarketImportResult };
  };
  'memory.retireAgent': {
    params: { role_id: string } & MemoryRetireOptions;
    result: { retire: RpcRetireResult };
  };
  /** 只出建议不落库；不传 role_id 就是全量扫描。 */
  'memory.retirementScan': {
    params: { role_id?: string };
    result: { scans: RpcRetirementScanResult[] };
  };
  /** 审批返回的是原始 SkillRecord（带 description_embedding），不是 SkillView。 */
  'memory.approveSkill': {
    params: { role_id: string; skill_id: string; reviewed_by?: string };
    result: { skill: RpcSkillRecord };
  };
  'memory.rejectSkill': {
    params: { role_id: string; skill_id: string; reviewed_by?: string };
    result: { skill: RpcSkillRecord };
  };
  'memory.createAgent': {
    params: MemoryCreateAgentSpec;
    result: { agent: RpcAgentBoardAgentView };
  };
  'memory.updateAgent': {
    params: { role_id: string } & MemoryAgentMetaPatch;
    result: { agent: RpcAgentBoardAgentView };
  };
  /**
   * 硬删除。`confirm` 必须是字面量 true；删未退休的 Agent 还要再给 `force: true`
   * —— 后端 schema 是 `z.literal(true)`，传 false 直接 -32602，不是「不强制」。
   */
  'memory.deleteAgent': {
    params: { role_id: string; confirm: true; force?: true };
    result: RpcMemoryDeleted;
  };
  'memory.createSkill': {
    params: MemoryCreateSkillInput;
    result: { skill: RpcSkillView };
  };
  'memory.updateSkill': {
    params: { role_id: string; skill_id: string } & MemorySkillWritePatch;
    result: { skill: RpcSkillView };
  };
  'memory.deleteSkill': {
    params: { role_id: string; skill_id: string };
    result: RpcMemoryDeleted;
  };
  'memory.publishSkillToMarket': {
    params: { role_id: string; skill_id: string };
    result: { skill: RpcSkillView };
  };
  'memory.updateExperience': {
    params: { role_id: string; experience_id: string } & MemoryExperienceWritePatch;
    result: { experience: RpcExperienceView };
  };
  'memory.deleteExperience': {
    params: { role_id: string; experience_id: string };
    result: RpcMemoryDeleted;
  };
  'memory.updatePersona': {
    params: { role_id: string } & MemoryPersonaPatch;
    result: { persona: RpcPersonaView };
  };
  'memory.regeneratePersona': {
    params: { role_id: string };
    result: { persona: RpcPersonaView };
  };
  'memory.rateTask': {
    params: { role_id: string; task_id: string; rating: MemoryUserRating; note?: string };
    result: { rating: RpcUserRatingResult };
  };
  'memory.getBufferState': {
    params: { role_id: string };
    result: { state: RpcBufferState };
  };
  /**
   * `seq` 必须是正整数（0 会被 schema 拒成 -32602）。查不到那一条时后端返回
   * `{ buffer: undefined }`，序列化后 `buffer` 键整个消失 —— 所以这里是可选键。
   */
  'memory.getPendingBuffer': {
    params: { role_id: string; seq: number };
    result: { buffer?: RpcPendingBuffer };
  };
  /** 把死信恢复成 pending 并重新入队维护链路，返回调度证据（不是提取结果）。 */
  'memory.retryExtraction': {
    params: { role_id: string; seq: number };
    result: { maintenance: MemoryMaintenanceEvidence };
  };

  'mailbox.send': {
    params: MailboxSendParams;
    result: { message: MailboxMessage; deliveries: MailboxDelivery[] };
  };
  'mailbox.inbox': {
    params: MailboxInboxParams;
    result: { deliveries: MailboxEnvelope[] };
  };
  'mailbox.ack': {
    params: MailboxAckParams;
    result: MailboxDelivery;
  };
  'mailbox.reply': {
    params: MailboxReplyParams;
    result: {
      source_delivery: MailboxDelivery;
      reply: { message: MailboxMessage; deliveries: MailboxDelivery[] };
    };
  };
}

export type RpcMethod = keyof RpcMethodMap;
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]['params'];
export type RpcResult<M extends RpcMethod> = RpcMethodMap[M]['result'];

export interface RpcNotificationMap {
  'task.event': { task_id: string; event: RunEvent };
  'run.event': { run_id: string; event: RunEvent };
}

export type RpcNotification = {
  [M in keyof RpcNotificationMap]: { method: M; params: RpcNotificationMap[M] };
}[keyof RpcNotificationMap];

export type { PingResult };

/**
 * 跨方向共享基础契约 —— 对齐 BCD `src/core/*`（newide-scaffold）。
 *
 * 这是各方向共用的 ID、时间戳、事件、制品、引用、租约、决策等原语，
 * 与方向 A（acp-client-prototype `src/core/types.ts`）实现保持一致。
 * 所有实体统一携带 `schema_version`，当前锚定 v0。
 */

// ── Schema 版本与 ID 别名（对齐 core/ids.ts） ──

export const SCHEMA_VERSION = 'v0' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;
export type Timestamp = string;

export type TaskId = string;
export type RunId = string;
export type AgentId = string;
export type RoleId = string;
export type DriverId = string;
export type DriverSessionId = string;
export type EventId = string;
export type ArtifactId = string;
export type CheckpointId = string;
export type DecisionId = string;
export type MessageId = string;
export type ThreadId = string;
export type LeaseId = string;
export type MemoryId = string;
export type ContextPackId = string;
export type GateResultId = string;
export type CouncilDecisionId = string;
export type DriverRunResultId = string;

export interface Versioned {
  schema_version: SchemaVersion;
}

// ── 流程事件（对齐 core/event.ts） ──
// 注意：这是"流程/审计"事件类型，命名与方向 D 的 HookPoint 不同。
// HookPoint 见 ./gate。两者刻意保持区分。

export type EventType =
  | 'task.created'
  | 'run.created'
  | 'driver.session_started'
  | 'memory.context_pack_built'
  | 'driver.run_result'
  | 'artifact.registered'
  | 'task.completed'
  | 'hook.matched'
  | 'gate.requested'
  | 'gate.result'
  | 'council.decision'
  | 'merge.authorization'
  | 'checkpoint.saved'
  | 'run.completed'
  // 允许扩展的开放式事件名
  | (string & {});

export interface Event {
  event_id: EventId;
  event_type: EventType;
  subject_id: string;
  run_id?: RunId;
  task_id?: TaskId;
  payload: Record<string, unknown>;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

// ── 制品（对齐 core/artifact.ts） ──

export type ArtifactType =
  | 'patch'
  | 'diff'
  | 'test_log'
  | 'review'
  | 'decision_packet'
  | 'checkpoint'
  | 'context'
  | 'transcript'
  | 'driver_result'
  | 'audit'
  | 'merge_authorization';

export interface ArtifactRef {
  artifact_id: ArtifactId;
  type: ArtifactType;
  uri: string;
  sha256?: string;
  producer_id: string;
  task_id?: TaskId;
  metadata?: Record<string, unknown>;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface DriverRunResultRef {
  driver_run_result_id: DriverRunResultId;
  uri: string;
  schema_version: SchemaVersion;
}

// ── 消息收件人与记忆/上下文引用（对齐 core/message.ts） ──

export interface MessageRecipient {
  agent_id?: string;
  role_id?: RoleId;
}

export interface MessageRef {
  message_id: MessageId;
  thread_id: ThreadId;
  schema_version: SchemaVersion;
}

/**
 * 角色画像所携带的记忆策略（core/message.ts 版本）。
 *
 * ⚠️ 上游命名冲突：BCD 在 `core/message.ts` 与 `memory/contract.ts` 中
 * 各有一个名为 `MemoryPolicy` 但字段不同的类型。此处为角色画像侧的策略，
 * 记忆装配侧的策略见 ./memory 中的 `MemoryPolicy`。
 */
export interface RoleMemoryPolicy {
  allow_in_driver_context: boolean;
  allow_in_council_proposer: boolean;
  allow_in_council_judge: boolean;
  max_memory_items: number;
}

export interface RoleProfileRef {
  role_id: RoleId;
  persona_ref: string;
  skill_refs: string[];
  capability_tags: string[];
  memory_policy: RoleMemoryPolicy;
  schema_version: SchemaVersion;
}

export interface MemoryRef {
  memory_id: MemoryId;
  kind: 'experience' | 'skill' | 'persona' | 'project' | 'team';
  uri: string;
  summary?: string;
  schema_version: SchemaVersion;
}

export interface ContextPackRef {
  context_pack_id: ContextPackId;
  uri: string;
  task_id?: TaskId;
  schema_version: SchemaVersion;
}

// ── 文件租约（对齐 core/lease.ts） ──

export type LeaseScope = 'read' | 'write';
export type LeaseStatus = 'active' | 'released' | 'expired' | 'conflicted';

export interface FileLease {
  lease_id: LeaseId;
  holder_id: string;
  path_glob: string;
  scope: LeaseScope;
  expires_at: Timestamp;
  status: LeaseStatus;
  schema_version: SchemaVersion;
}

export type PathLease = FileLease;

// ── 决策与合入授权（对齐 core/decision.ts） ──

export interface Decision {
  decision_id: DecisionId;
  run_id: RunId;
  task_id: TaskId;
  verdict: 'accepted' | 'rejected' | 'needs_revision' | 'deferred';
  reason: string;
  evidence_refs: ArtifactId[];
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/**
 * 合入授权 —— 权威定义（core/decision.ts）。
 * 注意：方向 C Council RFC 里另有一个更"人读"的 MergeAuthorization 形状，
 * 见 ./council 的 `CouncilMergeAuthorization`（前端前瞻类型）。
 */
export interface MergeAuthorization {
  merge_authorization_id: string;
  run_id: RunId;
  task_id: TaskId;
  selected_artifact_refs: ArtifactId[];
  gate_result_refs: GateResultId[];
  council_decision_ref?: CouncilDecisionId;
  status: 'authorized' | 'blocked' | 'revoked';
  reason?: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface CouncilDecisionRef {
  council_decision_id: CouncilDecisionId;
  uri: string;
  schema_version: SchemaVersion;
}

export interface GateResultRef {
  gate_result_id: GateResultId;
  uri: string;
  decision: 'allow' | 'deny' | 'ask' | 'defer';
  schema_version: SchemaVersion;
}

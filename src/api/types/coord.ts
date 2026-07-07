/**
 * 方向 C · 长程协调 API 类型 —— 对齐 BCD `src/core/{task,run,checkpoint,message}.ts`
 * 与 `src/coordinator/*`（newide-scaffold）。
 */

import type {
  AgentId,
  ArtifactId,
  CheckpointId,
  DriverId,
  DriverSessionId,
  MessageId,
  MessageRecipient,
  RoleId,
  RunId,
  SchemaVersion,
  TaskId,
  ThreadId,
  Timestamp,
} from './core';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ── Task（对齐 core/task.ts） ──

export type TaskStatus =
  | 'created'
  | 'triaged'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'waiting_help'
  | 'blocked'
  | 'escalated'
  | 'reviewing'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskBudget {
  max_tokens?: number;
  max_wall_clock_seconds?: number;
  max_tool_calls?: number;
}

export interface TaskCreateRequest {
  spec: string;
  role_id?: RoleId;
  parent_task_id?: TaskId;
  deps?: TaskId[];
  risk_level?: RiskLevel;
  affected_paths?: string[];
  completion_criteria: string[];
  budget?: TaskBudget;
}

/** 权威 Task 形状（core/task.ts 的 `Task`；旧名 `CoordTask` 已并入）。 */
export interface Task {
  task_id: TaskId;
  parent_id?: TaskId;
  status: TaskStatus;
  owner_agent_id?: AgentId;
  role_id?: RoleId;
  risk_level: RiskLevel;
  spec: string;
  completion_criteria: string[];
  affected_paths?: string[];
  budget?: TaskBudget;
  created_at: Timestamp;
  updated_at: Timestamp;
  schema_version: SchemaVersion;
}

/** @deprecated 使用 `Task`（保留别名以兼容既有前端引用）。 */
export type CoordTask = Task;

// ── Run / AgentSession（对齐 core/run.ts） ──

export type RunStatus =
  | 'created'
  | 'running'
  | 'waiting_gate'
  | 'waiting_council'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Run {
  run_id: RunId;
  task_id: TaskId;
  status: RunStatus;
  created_at: Timestamp;
  updated_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface AgentSession {
  agent_id: AgentId;
  role_id?: string;
  driver_id: DriverId;
  session_id: DriverSessionId;
  run_id: RunId;
  task_id: TaskId;
  status: 'starting' | 'running' | 'interrupted' | 'closed' | 'failed';
  created_at: Timestamp;
  updated_at: Timestamp;
  schema_version: SchemaVersion;
}

// ── Checkpoint（对齐 core/checkpoint.ts） ──

export type CheckpointType = 'full' | 'incremental';
export type CheckpointTrigger = 'manual' | 'periodic' | 'shutdown' | 'blocked' | 'escalated';
export type CheckpointValidity = 'valid' | 'invalid' | 'superseded';

export interface MechanicalSnapshot {
  base_commit: string;
  snapshot_commit?: string;
  worktree_path: string;
  branch: string;
  modified_files: string[];
  diff_artifact_id?: ArtifactId;
  test_artifact_ids?: ArtifactId[];
}

export interface SemanticHandoff {
  done: string[];
  in_progress: string[];
  blocked_on: string[];
  assumptions: string[];
  next_steps: string[];
  known_risks: string[];
}

export interface RuntimeStateSnapshot {
  scheduler_policy?: string;
  current_turn?: number;
  next_agent_ref?: string;
  resume_cursor?: string;
}

export interface InterruptState {
  waiting_for: string[];
  timeout_at?: Timestamp;
  resume_condition?: string;
  resume_value_artifact_id?: ArtifactId;
}

/** 权威 Checkpoint 形状（core/checkpoint.ts 的 `Checkpoint`；旧名 `CheckpointRecord` 已并入）。 */
export interface Checkpoint {
  checkpoint_id: CheckpointId;
  parent_checkpoint_id?: CheckpointId;
  checkpoint_type: CheckpointType;
  task_id: TaskId;
  agent_id?: AgentId;
  trigger: CheckpointTrigger;
  mechanical_snapshot: MechanicalSnapshot;
  semantic_handoff: SemanticHandoff;
  runtime_state?: RuntimeStateSnapshot;
  interrupt_state?: InterruptState;
  artifact_refs: ArtifactId[];
  validity_status: CheckpointValidity;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/** @deprecated 使用 `Checkpoint`。 */
export type CheckpointRecord = Checkpoint;

// ── Message（对齐 core/message.ts） ──

export type AgentMessageType =
  | 'ask_help'
  | 'review_request'
  | 'proposal'
  | 'critique'
  | 'handoff'
  | 'status_update'
  | 'decision_request'
  | 'decision_response';

/** 权威 Message 形状（core/message.ts 的 `Message`；旧名 `AgentMessage` 已并入）。 */
export interface Message {
  message_id: MessageId;
  thread_id: ThreadId;
  from_agent_id: string;
  to: MessageRecipient[];
  type: AgentMessageType;
  payload: Record<string, unknown>;
  artifact_refs?: ArtifactId[];
  checkpoint_ref?: CheckpointId;
  causal_event_id?: string;
  requires_ack: boolean;
  deadline_seconds?: number;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/** @deprecated 使用 `Message`。 */
export type AgentMessage = Message;

// ── Resume（后端规划中·前端保留） ──
// BCD `coordinator-contract.ts` 明确把"完整 resume"列为尚未覆盖的待补齐项，
// 属后端打算实现但 v0 未落地。依"后端打算实现则前端保留"原则保留。

export interface ResumeRequest {
  task_id: TaskId;
  checkpoint_id: CheckpointId;
}

export interface ResumeResponse {
  task_id: TaskId;
  restored_state: 'ready' | 'running';
  resume_cursor: string;
}

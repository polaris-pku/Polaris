/**
 * 方向 D · Hook / Gate API 类型 —— 对齐 BCD `src/gate/gate.ts` 与 `src/hook/*`
 * （newide-scaffold）。方向 A 的 SPEC §4 也审计对齐了同一套契约。
 */

import type { GateResultId, SchemaVersion, Timestamp } from './core';
import type { TaskStatus } from './coord';

// ── Gate（对齐 gate/gate.ts） ──

export type GateDecision = 'allow' | 'deny' | 'ask' | 'defer';

export interface GateRequest {
  gate_id: string;
  gate_point: string;
  request_id: string;
  priority: number;
  denying?: boolean;
  timeout_ms: number;
  created_at: Timestamp;
  payload?: Record<string, unknown>;
  schema_version: SchemaVersion;
  subject_id?: string;
}

export interface GateResult {
  gate_result_id: GateResultId;
  gate_id: string;
  gate_point: string;
  request_id: string;
  subject_id?: string;
  subject_type?: 'task' | 'artifact' | 'proposal' | 'merge_attempt' | 'council' | (string & {});
  causal_event_id?: string;
  attempt_id?: string;
  subject_version?: number;
  decision: GateDecision;
  reason: string;
  required_actions: string[];
  audit_ref?: string;
  target_state?: TaskStatus | (string & {});
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface GateOutputConfig {
  severity_map?: Record<string, 'deny' | 'ask' | 'defer' | 'allow'>;
  threshold?: {
    line?: number;
    branch?: number;
  };
  on_fail?: 'deny' | 'ask' | 'defer' | 'allow';
  on_below_threshold?: 'deny' | 'ask' | 'defer' | 'allow';
}

export interface SubGateRef {
  gate_id: string;
  required?: boolean;
}

export interface GateDefinition {
  type: 'command' | 'prompt' | 'composite' | 'http';
  command?: string;
  model?: string;
  prompt?: string;
  input?: string;
  gates?: SubGateRef[];
  outputConfig: GateOutputConfig;
  timeout?: number;
  retry_threshold: number;
}

// ── Hook 点位（对齐 hook/constants.ts 的 HookPoint 命名空间并集） ──
// 与 core EventType 刻意区分：EventType 是流程/审计事件，HookPoint 是拦截点位。

/** agent.* 命名空间 */
export type AgentHookPoint =
  | 'agent.pre_tool_use'
  | 'agent.post_tool_use'
  | 'agent.post_tool_use_fail'
  | 'agent.message_send'
  | 'agent.message_recv'
  | 'agent.checkpoint'
  | 'agent.session_start'
  | 'agent.session_end'
  | 'agent.experience_extracted'
  | 'agent.skill_promoted'
  | 'agent.respawn'
  | 'agent.respawned';

/** task.* 命名空间 */
export type TaskHookPoint =
  | 'task.created'
  | 'task.claimed'
  | 'task.checkpoint_resume'
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'task.escalated'
  | 'task.delegated'
  | 'task.before_merge';

/** council.* 命名空间 */
export type CouncilHookPoint =
  | 'council.started'
  | 'council.context_packaged'
  | 'council.profile_snapshot_saved'
  | 'council.extraction_completed'
  | 'council.proposal'
  | 'council.proposal_deadline'
  | 'council.review'
  | 'council.diff_ready'
  | 'council.review_round_end'
  | 'council.decision'
  | 'council.completed';

/** lifecycle.* 命名空间 */
export type LifecycleHookPoint =
  | 'lifecycle.project_open'
  | 'lifecycle.build_start'
  | 'lifecycle.build_end'
  | 'lifecycle.human_gate';

/** system.* 命名空间 */
export type SystemHookPoint =
  | 'system.heartbeat'
  | 'system.budget_exceeded'
  | 'system.timeout'
  | 'system.agent_crash'
  | 'system.config_change'
  | 'system.worktree_create';

export type HookPoint =
  | AgentHookPoint
  | TaskHookPoint
  | CouncilHookPoint
  | LifecycleHookPoint
  | SystemHookPoint;

/** @deprecated 使用 `HookPoint`（旧名 `HookEventType`，且旧并集缺失若干点位）。 */
export type HookEventType = HookPoint;

/** Phase 1 mock 流程启用的点位子集（对齐 hook/constants.ts PHASE_1_HOOK_POINTS）。 */
export const PHASE_1_HOOK_POINTS: HookPoint[] = [
  'task.created',
  'task.claimed',
  'task.started',
  'task.completed',
  'task.failed',
  'agent.checkpoint',
  'agent.message_send',
  'system.timeout',
  'lifecycle.human_gate',
];

// ── Hook 运行时（对齐 hook/hook.ts） ──
// HookEvent 结构上 extends core Event（多了 run_id/task_id/schema_version）。

export interface HookEvent<T = Record<string, unknown>> {
  event_id: string;
  event_type: HookPoint;
  subject_id: string;
  run_id?: string;
  task_id?: string;
  payload: T;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface HookResult {
  hook_point: HookPoint | string;
  matched: boolean;
  gate_requests: GateRequest[];
  gate_results: GateResult[];
  final_decision: GateDecision;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

// ── 纯前端内部解读的 payload 形状（不构成对后端的契约要求） ──
// 后端只保证 hook event 的 payload 为 Record<string,unknown>，且不打算做成强类型。
// 以下类型仅供前端在渲染时"尝试性解读"payload，绝不反向要求后端按此结构填充。

export type HumanGatePayload = {
  gate_id: string;
  gate_point: string;
  subject_id: string;
  gate_reason: string;
  decision_options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  context_pack_ref: string;
  timeout_seconds: number;
  agent_recommendation?: string;
  impact_summary?: string;
};

export type TaskProgressPayload = {
  task_id: string;
  agent_id: string;
  percent: number;
  progress_message: string;
  done_items: string[];
  in_progress_items: string[];
  blocked_items: string[];
};

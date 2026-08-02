/**
 * 方向 B · 记忆 / 上下文装配契约 —— 对齐 BCD `src/memory/contract.ts`（newide-scaffold）。
 *
 * ContextPack 是 Coordinator → Agent 之间传递记忆信息的数据载体。
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

export interface MemoryOperationCapability {
  status: 'available' | 'unavailable';
  reason?: string;
}

export interface MemoryCapabilities {
  schema_version: 'newide.b-memory-capabilities.v1';
  embedding: {
    provider: string;
    task?: string;
    model?: string;
    dimensions?: number;
    readiness: 'verified' | 'host_managed';
  };
  operations: Record<string, MemoryOperationCapability>;
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
  persona: unknown;
  metrics: { raw: unknown; derived: unknown };
  created_at: string;
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
  imported_by?: string[];
  linked_negative_exp?: string[];
  market_status?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
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
  confidence_history: Array<{ value: number; updated_at: string; reason: string }>;
  referenced_count: number;
  last_referenced_at?: string;
  source_task_id: string;
  source_driver: string;
  source_user_rating?: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryMaintenanceEvidence {
  maintenance_ref: string;
  kind: 'experience_extraction' | 'skill_promotion';
  status: 'scheduled' | 'running' | 'completed' | 'skipped' | 'failed';
  role_id: string;
  task_id?: string;
  run_id?: string;
  buffer_seq?: number;
  requested_by?: string;
  experiences: unknown[];
  skills: unknown[];
  warnings: string[];
  error?: string;
  evidence_uri?: string;
  created_at: string;
  completed_at: string;
  schema_version: string;
}

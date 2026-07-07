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

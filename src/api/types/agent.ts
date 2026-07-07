/**
 * 方向 B · Agent 角色与记忆展示类型。
 *
 * `PersonaDef` / `AgentMetrics` 为前端展示用的画像/指标视图，
 * 后端权威落库结构见 BCD `src/memory/schemas.ts`（Zod Schema），本文件为其人读投影。
 * `DriverInfo` 的能力字段已对齐方向 A/BCD 的结构化 `DriverCapabilities`。
 */

import type { AuthStrategy, DriverCapabilities } from './driver';

export type PersonaDef = {
  role_id: string;
  version: number;
  summary: string;
  skills_overview: string;
  experience_coverage: string;
  recent_performance: string;
  notes: string;
  generated_at: string;
};

export type AgentMetrics = {
  role_id: string;
  period_start: string;
  period_end: string;
  total_tasks: number;
  success_rate: number;
  average_confidence: number;
  skill_count: number;
  experience_count: number;
  token_cost_total: number;
  intervention_count: number;
  council_win_rate: number;
  failure_types: string[];
  collaboration_score: string;
};

/**
 * Driver 展示信息。
 * `auth_strategy` 对齐方向 A `AuthStrategy`；`capabilities` 对齐结构化 `DriverCapabilities`
 * （旧版为 `string[]`，已改为结构体以匹配后端契约）。
 */
export type DriverInfo = {
  driver_id: string;
  name: string;
  auth_strategy: AuthStrategy;
  connected: boolean;
  capabilities: DriverCapabilities;
  /** 可选的人读能力标签，仅用于列表展示 */
  capability_tags?: string[];
};

/** Agent 运行态状态集（供前端 UI 直接复用，避免各处重复声明字面量联合）。 */
export type AgentRuntimeStatus = 'idle' | 'working' | 'waiting' | 'reviewing' | 'done';

/**
 * Agent 运行态视图（前端用）。
 * 与 BCD core/run.ts 的 `AgentSession` 对应，但此处是面向 UI 的精简/展示形状。
 */
export type AgentRuntimeState = {
  agent_id: string;
  role_id: string;
  status: AgentRuntimeStatus;
  current_task_id?: string;
  current_node_id?: string;
  current_action?: string;
  current_files?: string[];
  driver_id: string;
  worktree_id?: string;
};

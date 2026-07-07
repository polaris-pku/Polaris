/**
 * 方向 B · Agent 角色与记忆展示类型（Agent Board 契约镜像）。
 *
 * 权威源：BCD `github.com/Neighhhbor/newide-scaffold`
 *   - `src/memory/ports/agent-board-query.ts`（AgentBoard 只读入口 + DTO）
 *   - `src/memory/schemas.ts`（PersonaDef / AgentMetrics / DerivedMetrics 的 Zod Schema）
 * 本文件为其人读投影：只镜像 B 真实刻画的字段，不臆造。
 * `DriverInfo` 的能力字段已对齐方向 A/BCD 的结构化 `DriverCapabilities`。
 */

import type { AuthStrategy, DriverCapabilities } from './driver';

/** Agent 生命周期状态（对齐 BCD schemas.ts `AgentStatusSchema`）。 */
export type AgentLifecycle = 'created' | 'active' | 'idle' | 'draining' | 'retired';

/** 角色画像（schemas.ts `PersonaDefSchema` 的人读投影）。 */
export type PersonaDef = {
  role_id: string;
  /** Persona 版本号（每次重新生成时递增） */
  version: number;
  summary: string;
  skills_overview: string;
  experience_coverage: string;
  recent_performance: string;
  notes: string;
  generated_at: string;
};

/**
 * Agent 原始指标（持久化）——对齐 schemas.ts `AgentMetricsSchema`。
 * 仅原始计数，比率类由 `calculateDerivedMetrics` 实时派生。
 */
export type AgentMetrics = {
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
  /** 所有经验的加权平均置信度（0~1） */
  avg_confidence: number;
  token_cost_total: number;
  first_task_at?: string;
  last_task_at?: string;
  last_won_at?: string;
  persona_version: number;
  /** Persona 漂移度（0~1，越高表示当前表现与 Persona 描述差异越大） */
  persona_drift?: number;
  persona_stable_since?: string;
};

/**
 * 派生指标（实时计算，不持久化）——对齐 schemas.ts `DerivedMetrics`。
 * 计算见 `@/lib/agentMetrics` `calculateDerivedMetrics`。
 */
export type DerivedMetrics = {
  /** 任务成功率 = tasks_succeeded / tasks_completed */
  success_rate: number;
  /** 投标胜率 = tasks_won / tasks_bid */
  bid_win_rate: number;
  /** 经验密度 = experience_count / total_tasks */
  experience_density: number;
  /** 技能密度 = skill_count / experience_count */
  skill_density: number;
  /** 活跃度评分（最近任务距今，14 天半衰期） */
  activity_score: number;
};

/**
 * 技能对外视图（agent-board-query.ts `SkillView` 的精简投影，剔除 embedding）。
 * 展示层只取人读关键字段。
 */
export type SkillView = {
  id: string;
  description: string;
  version: string;
  review_status: string;
  tags: string[];
  /** 由某条经验晋升而来时的来源标记 */
  promoted_from?: string;
};

/**
 * 经验对外视图（agent-board-query.ts `ExperienceView` 的精简投影，剔除 embedding）。
 */
export type ExperienceView = {
  id: string;
  description: string;
  confidence: number;
  type: 'positive' | 'negative';
  tags: string[];
  referenced_count: number;
};

/** Board 卡片 DTO（`AgentBoardListItem`）——轻量摘要，不含 metrics/persona 全文。 */
export type AgentBoardListItem = {
  role_id: string;
  name: string;
  status: AgentLifecycle;
  tags?: string[];
  skill_count: number;
  experience_count: number;
  persona_summary: string;
};

/** Board 详情 DTO（`AgentBoardAgentView`）——头部 + 画像 + 指标（raw + derived）。 */
export type AgentBoardAgentView = {
  role_id: string;
  name: string;
  status: AgentLifecycle;
  tags?: string[];
  skill_count: number;
  experience_count: number;
  persona: PersonaDef;
  metrics: {
    raw: AgentMetrics;
    derived: DerivedMetrics;
  };
  created_at: string;
};

/**
 * Driver 展示信息。
 * `auth_strategy` 对齐方向 A `AuthStrategy`；`capabilities` 对齐结构化 `DriverCapabilities`。
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

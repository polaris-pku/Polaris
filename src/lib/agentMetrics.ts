import type { AgentMetrics, DerivedMetrics } from '@/api/types/agent';

/**
 * 由原始 `AgentMetrics` 实时派生比率指标。
 * 逐行对齐 BCD `src/memory/schemas.ts` 的 `calculateDerivedMetrics`。
 */
export function calculateDerivedMetrics(m: AgentMetrics): DerivedMetrics {
  const daysSinceLastTask = m.last_task_at
    ? (Date.now() - new Date(m.last_task_at).getTime()) / (1000 * 60 * 60 * 24)
    : 30;

  return {
    success_rate: m.tasks_completed > 0 ? m.tasks_succeeded / m.tasks_completed : 0,
    bid_win_rate: m.tasks_bid > 0 ? m.tasks_won / m.tasks_bid : 0,
    experience_density: m.total_tasks > 0 ? m.experience_count / m.total_tasks : 0,
    skill_density: m.experience_count > 0 ? m.skill_count / m.experience_count : 0,
    activity_score: 1.0 / (1.0 + daysSinceLastTask / 14),
  };
}

/** 0~1 → 百分比整数文案。 */
export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** 保留两位有效小数的密度/评分文案。 */
export function ratio(v: number): string {
  return v.toFixed(2);
}

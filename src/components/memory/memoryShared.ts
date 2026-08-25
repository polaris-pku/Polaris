/**
 * 记忆面板的公共**常量与纯函数**。
 *
 * 与 `shared.tsx` 分成两个文件，是因为 `react-refresh/only-export-components`：
 * 一个文件里既导出组件又导出常量，热更新就只能整页刷。组件在 .tsx，其余在这里。
 */
import type { MemoryCapabilities, MemoryOperationName } from '@/api/types/memory';
import type { BadgeProps } from '@/components/ui/Badge';

export const INPUT_CLASS =
  'w-full rounded-panel border border-edge-strong bg-surface-void px-3 py-2 text-body text-fg-primary placeholder:text-fg-faint focus:border-command focus:outline-none focus:ring-1 focus:ring-command/40';

/** 退休资产池的固定 role_id：技能落在这里表示原主人已退休。市场检索只搜这个池。 */
export const MARKET_POOL_ROLE_ID = '__market__';

/** 线上 `review_status` 声明为宽 string，这里只做翻译，认不出来的原样透出（见 WireBadge）。 */
export const REVIEW_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export const REVIEW_TONE: Record<string, BadgeProps['variant']> = {
  pending: 'human',
  approved: 'ok',
  rejected: 'danger',
};

/** `retired_unique` 只由退休流程写入，手工 PATCH 写不进，但读得到。 */
export const MARKET_LABEL: Record<string, string> = {
  available: '已上架',
  superseded: '已废弃',
  retired_unique: '退休独有',
};

export const MARKET_TONE: Record<string, BadgeProps['variant']> = {
  available: 'ok',
  superseded: 'default',
  retired_unique: 'human',
};

export const OPERATION_LABEL: Partial<Record<MemoryOperationName, string>> = {
  list_skills: '技能列表',
  create_skill: '新建技能',
  update_skill: '编辑技能',
  delete_skill: '删除技能',
  publish_skill: '上架市场',
  list_pending_reviews: '待审队列',
  approve_skill: '通过审核',
  reject_skill: '驳回技能',
  market_search: '市场检索',
  market_import: '引入技能',
  get_overview: '记忆总览',
  reindex: '重建索引',
  create_agent: '新建 Agent',
  retirement_scan: '退休扫描',
};

export const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export const parseTags = (raw: string): string[] =>
  raw
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

export function parsePositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseUnitFloat(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

export function fixed3(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}

export function intText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

// ── 能力门控 ──

export const can = (
  capabilities: MemoryCapabilities | undefined,
  op: MemoryOperationName,
): boolean => capabilities?.operations[op]?.status === 'available';

// ── 退休扫描 ──

export const SCAN_ACTION_LABEL: Record<string, string> = {
  retire: '建议退休',
  warn: '需要关注',
  keep: '建议保留',
};

export const LAYER_LABEL: Record<string, string> = {
  statistical: '统计门控',
  persona_drift: '画像漂移',
  llm: '模型评估',
};

export const ratio = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '—');

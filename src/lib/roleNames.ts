/**
 * role_id → 显示名。
 *
 * 主层永不显示蛇形 id：`role_ts_engineer` 是数据库主键，不是人名。
 * 原文只允许活在 L3（Dock 的事件流频道）与 D2 的灰色注解里。
 */
export const ROLE_NAMES: Record<string, string> = {
  backend_engineer: '后端工程师',
  frontend_engineer: '前端工程师',
  test_engineer: '测试工程师',
  security_auditor: '安全审计',
  role_ts_engineer: 'TypeScript 工程师',
  role_fullstack_engineer: '全栈工程师',
};

/** 缺失 → 'Agent'（不回落到蛇形 id）。 */
export const roleName = (id?: string): string => (id && ROLE_NAMES[id]) || 'Agent';

/** 只知道 driver_id、拿不到 role_id 时的执行者名（主句用）。 */
export const OWNER_FALLBACK = '后端 Agent';

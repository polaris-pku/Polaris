/**
 * 需求文本 → 建议 Agent 团队（N1 分诊「建议角色」的展示层启发式）。
 *
 * 纯客户端猜测，**不发给后端**：真实运行永远只有一个 agent（打包版只随包分发 Claude Code），
 * 这里给的是「团队」页上的一份建议名单，用户可以自己增删。
 *
 * 它原本住在 `data/scenario.ts` 里 —— 那个文件同时还按关键词编造整套演示场景
 * （议会议程 / 交付报告 / 需求分析）。那些内容随「界面只呈现真实 run」一路删干净后，
 * 文件里只剩这一个函数，名字却还叫「场景推导」。所以搬出来单独放，
 * 领域包也只保留真正被读到的两个字段（tag / keywords）。
 */

/** 领域包：只用来把需求文本归到一个 tag 上。 */
type DomainPack = { tag: string; keywords: string[] };

const FLAVORED_PACKS: DomainPack[] = [
  {
    tag: '权限 / 鉴权',
    keywords: [
      '权限',
      '鉴权',
      '登录',
      'auth',
      'permission',
      'login',
      'oauth',
      'sso',
      'token',
      '角色',
    ],
  },
  {
    tag: '支付 / 计费',
    keywords: [
      '支付',
      '付款',
      '订阅',
      '退款',
      '计费',
      '结算',
      'billing',
      'payment',
      'stripe',
      'checkout',
      'invoice',
    ],
  },
  {
    tag: 'API / 文档',
    keywords: ['api', '接口', '文档', 'openapi', 'swagger', 'sdk', 'restful', 'rest'],
  },
];

/** 需求文本 → 领域 tag。命不中任何领域包就是「通用」。顺序即优先级。 */
function pickTag(taskText: string): string {
  const t = taskText.toLowerCase();
  const hit = FLAVORED_PACKS.find((p) =>
    p.keywords.some((k) => taskText.includes(k) || t.includes(k)),
  );
  return hit?.tag ?? '通用';
}

/** 领域 → 建议团队（基础三人：后端实现 + 测试覆盖 + 安全审查）。 */
const TEAM_BY_TAG: Record<string, { ids: string[]; reason: string }> = {
  '权限 / 鉴权': {
    ids: ['backend-a', 'security-agent', 'test-agent'],
    reason: '权限任务：后端实现权限模型 · 安全审查越权 · 测试覆盖高风险路径',
  },
  '支付 / 计费': {
    ids: ['backend-a', 'test-agent', 'security-agent'],
    reason: '支付任务：后端保障扣款一致性 · 测试幂等与对账 · 安全审查资金风险',
  },
  'API / 文档': {
    ids: ['backend-a', 'test-agent', 'security-agent'],
    reason: 'API/文档任务：后端定义 Schema · 测试校验契约 · 安全审查字段暴露',
  },
  通用: {
    ids: ['backend-a', 'test-agent', 'security-agent'],
    reason: '通用任务：后端实现 · 测试覆盖 · 安全审查',
  },
};

/** 命中这些词时额外建议前端 Agent 参与。 */
const UI_KEYWORDS = [
  '前端',
  '页面',
  '组件',
  '界面',
  'ui',
  '样式',
  '交互',
  '按钮',
  '表单',
  '弹窗',
  '布局',
];

/**
 * 按需求文本推荐 Agent 团队。
 * 空需求返回空数组（新项目未输入需求前不推荐，团队保持为空）。
 */
export function recommendAgents(taskText: string): { ids: string[]; reason: string } {
  if (!taskText.trim()) return { ids: [], reason: '' };
  const base = TEAM_BY_TAG[pickTag(taskText)] ?? TEAM_BY_TAG['通用'];
  const ids = [...base.ids];
  const t = taskText.toLowerCase();
  const needFrontend = UI_KEYWORDS.some((k) => taskText.includes(k) || t.includes(k));
  if (needFrontend && !ids.includes('frontend-b')) ids.push('frontend-b');
  const reason = needFrontend ? `${base.reason} · 前端联调受控 UI` : base.reason;
  return { ids, reason };
}

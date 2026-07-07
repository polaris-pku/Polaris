import type { CouncilOption, DiscussionMessage } from '@/types';

/**
 * 需求驱动的场景推导（mock）。
 *
 * 输入一条需求文本 → 产出一整套"跟着需求变"的演示内容：
 * 需求分析(Task Understanding) / 议会方案(Council) / 交付报告(Delivery)。
 *
 * 做法：按关键词命中一个"领域包"（权限/支付/API…），命不中则走通用模板；
 * 再把从需求里抽出的主题(subject)插进各字段，让不同需求呈现不同结果。
 * 纯函数、无随机：同一条需求恒定产出同一套场景，保证议会选项 id 在
 * CouncilBoard 与 DeliveryReport 两处一致。
 */

export type Scenario = {
  subject: string;
  domain: string;
  understanding: {
    goal: string;
    modules: string[];
    testDir: string;
    risks: string[];
    workflow: string;
  };
  council: {
    context: {
      title: string;
      description: string;
      decisionMode: string;
      councilId: string;
    };
    discussion: DiscussionMessage[];
    options: CouncilOption[];
    evidenceRefs: string[];
    riskSignals: string[];
    recommendedReason: string;
  };
  delivery: {
    summary: string;
    changedFiles: string[];
    testResult: { passed: number; failed: number; coverageDelta: string };
    riskNotes: string[];
  };
};

/** 三个候选方案的领域化描述（id 固定 option-a/b/c，A 为推荐项）。 */
type OptSpec = Omit<CouncilOption, 'id'>;

type DomainPack = {
  tag: string;
  keywords: string[];
  modules: [string, string, string];
  testDir: string;
  workflow: string;
  risks: [string, string, string];
  /** 议会要裁决的核心分歧（一句话） */
  conflict: string;
  options: [OptSpec, OptSpec, OptSpec];
  discussion: DiscussionMessage[];
  evidenceRefs: string[];
  riskSignals: string[];
  recommendedReason: string;
  changedFiles: string[];
  passed: number;
  coverageDelta: string;
  riskNotes: string[];
};

// ── 工具 ──

/** 从需求文本抽取一个简短主题：取首行、去尾部标点。 */
function extractSubject(taskText: string): string {
  const firstLine = (taskText.split('\n')[0] ?? '').trim();
  const cleaned = firstLine.replace(/[。.!！?？;；,，、\s]+$/u, '').trim();
  return cleaned || '该需求';
}

/** 稳定 4 位散列，用于派生 council_id（避免随机、保证可复现）。 */
function hash4(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ((h % 9000) + 1000).toString();
}

// ══════════════════════════════════════════════════
//  领域包
// ══════════════════════════════════════════════════

const authPack: DomainPack = {
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
  modules: ['authMiddleware.ts', 'permissionService.ts', 'userRole.ts'],
  testDir: 'tests/auth/',
  workflow: '功能开发 + 测试 + 安全审查 + Review',
  risks: ['Admin 越权', '组织级权限', '未授权访问'],
  conflict: '两种权限策略（RBAC 与 Feature Flag）需要择一',
  options: [
    {
      title: 'Option A · 基于角色的访问控制 (RBAC)',
      proposedBy: 'Backend Eng A',
      summary: '复用已有用户角色模型，在中间件层做统一权限拦截。',
      pros: [
        '复用现有 userRole 模型，改动面最小',
        '权限边界清晰可枚举，易测试',
        '符合最小权限原则，安全可控',
      ],
      risks: ['Admin 角色权限范围需单独定义', '角色粒度较粗，细分场景需扩展'],
      impactedFiles: ['authMiddleware.ts', 'permissionService.ts', 'userRole.ts'],
      scores: { 落地速度: 9, 可测试性: 9, 安全性: 8, 灵活性: 6 },
      recommended: true,
    },
    {
      title: 'Option B · 基于特性开关的权限',
      proposedBy: 'Frontend Eng B',
      summary: '用 Feature Flag 动态控制每个能力点的可见与可用。',
      pros: ['灰度与按用户精细控制强', '不发版即可调整权限'],
      risks: ['flag 组合爆炸，难以穷举测试', '权限语义分散，审计困难', '与角色模型割裂，改动面大'],
      impactedFiles: ['featureFlagService.ts', 'permissionService.ts', 'authMiddleware.ts'],
      scores: { 落地速度: 5, 可测试性: 4, 安全性: 6, 灵活性: 9 },
    },
    {
      title: 'Option C · 混合策略',
      proposedBy: 'Security Audit Agent',
      summary: '以 RBAC 为基座做粗粒度权限，叠加少量 Feature Flag 处理灰度。',
      pros: ['兼顾稳定模型与灰度灵活', '可平滑演进'],
      risks: ['两套机制叠加，复杂度上升', '边界不清会产生权限盲区'],
      impactedFiles: [
        'authMiddleware.ts',
        'permissionService.ts',
        'userRole.ts',
        'featureFlagService.ts',
      ],
      scores: { 落地速度: 6, 可测试性: 6, 安全性: 7, 灵活性: 8 },
    },
  ],
  discussion: [
    {
      agent: 'Backend Eng A',
      role: '后端工程 Agent',
      accent: 'backend',
      message: '建议 RBAC。用户角色模型已存在，userRole.ts 可直接复用，改动面最小、落地最快。',
    },
    {
      agent: 'Test Agent',
      role: '测试 Agent',
      accent: 'test',
      message: 'RBAC 权限边界清晰可枚举，容易补覆盖测试；Feature Flag 组合爆炸难以穷举。',
    },
    {
      agent: 'Security Audit Agent',
      role: '安全审查 Agent',
      accent: 'security',
      message: '无论哪种方案都要重点查 Admin bypass 与未授权访问，RBAC 配最小权限更可控。',
    },
  ],
  evidenceRefs: [
    'artifact://review/security-audit-017',
    'artifact://test_log/permission-suite',
    'artifact://diff/rbac-vs-flag',
    'artifact://context/role-permission-model',
  ],
  riskSignals: [
    'Admin bypass 越权面可能扩大',
    'Feature Flag 组合爆炸，难以穷举测试',
    '权限语义分散会增加审计成本',
  ],
  recommendedReason:
    'Backend、Test、Security 三方在落地速度、可测试性与安全性上一致更看好 RBAC：复用现有角色模型、边界可枚举、便于补测，并符合最小权限原则。',
  changedFiles: [
    'authMiddleware.ts',
    'permissionService.ts',
    'userRole.ts',
    'authMiddleware.test.ts',
    'permissionService.test.ts',
  ],
  passed: 28,
  coverageDelta: '+8.4%',
  riskNotes: ['建议重点检查 Admin 角色权限范围是否符合产品预期'],
};

const paymentPack: DomainPack = {
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
  modules: ['paymentService.ts', 'orderService.ts', 'webhookHandler.ts'],
  testDir: 'tests/payment/',
  workflow: '功能开发 + 幂等测试 + 对账校验 + 安全审查 + Review',
  risks: ['重复扣款', '回调乱序', '对账不一致'],
  conflict: '扣款一致性方案（同步事务 与 异步事件驱动）需要择一',
  options: [
    {
      title: 'Option A · 同步事务 + 对账兜底',
      proposedBy: 'Backend Eng A',
      summary: '下单即在同一事务内扣款，配合定时对账兜底异常单。',
      pros: ['强一致，用户即时看到结果', '链路直观、易排障', '对账兜底覆盖极端失败'],
      risks: ['峰值下数据库压力大', '外部网关超时会阻塞下单'],
      impactedFiles: ['paymentService.ts', 'orderService.ts', 'reconcileJob.ts'],
      scores: { 落地速度: 8, 可测试性: 8, 安全性: 8, 灵活性: 6 },
      recommended: true,
    },
    {
      title: 'Option B · 异步事件驱动',
      proposedBy: 'Frontend Eng B',
      summary: '下单先挂起，扣款经消息队列异步处理，回调更新状态。',
      pros: ['削峰能力强、吞吐高', '网关抖动不阻塞主链路'],
      risks: ['最终一致，存在短暂中间态', '回调乱序/重放需额外幂等', '状态机复杂度高'],
      impactedFiles: ['paymentQueue.ts', 'webhookHandler.ts', 'orderStateMachine.ts'],
      scores: { 落地速度: 5, 可测试性: 5, 安全性: 7, 灵活性: 9 },
    },
    {
      title: 'Option C · 混合（同步下单 + 异步履约）',
      proposedBy: 'Security Audit Agent',
      summary: '扣款同步保证一致，履约与通知走异步，两段幂等隔离。',
      pros: ['关键一致 + 非关键削峰', '可平滑演进'],
      risks: ['两套幂等边界需谨慎划分', '运维与监控成本上升'],
      impactedFiles: [
        'paymentService.ts',
        'webhookHandler.ts',
        'orderStateMachine.ts',
        'reconcileJob.ts',
      ],
      scores: { 落地速度: 6, 可测试性: 6, 安全性: 8, 灵活性: 8 },
    },
  ],
  discussion: [
    {
      agent: 'Backend Eng A',
      role: '后端工程 Agent',
      accent: 'backend',
      message: '建议同步事务扣款。资金链路强一致最重要，异步的中间态会让客服与对账都难受。',
    },
    {
      agent: 'Test Agent',
      role: '测试 Agent',
      accent: 'test',
      message: '同步方案的用例边界清楚；异步要额外覆盖回调乱序与重放，幂等键必须先定义。',
    },
    {
      agent: 'Security Audit Agent',
      role: '安全审查 Agent',
      accent: 'security',
      message: '无论哪种方案，重复扣款与 webhook 伪造是红线，必须校验签名并做幂等去重。',
    },
  ],
  evidenceRefs: [
    'artifact://review/payment-audit-042',
    'artifact://test_log/idempotency-suite',
    'artifact://diff/sync-vs-async-charge',
    'artifact://context/order-payment-model',
  ],
  riskSignals: ['回调重放导致重复扣款', '网关超时引发订单悬挂', '对账口径不一致难以定位差错'],
  recommendedReason:
    '资金链路以一致性优先：同步事务让扣款结果即时可见、用例边界清晰，配合对账兜底即可覆盖极端失败，综合风险最低。',
  changedFiles: [
    'paymentService.ts',
    'orderService.ts',
    'webhookHandler.ts',
    'paymentService.test.ts',
    'reconcile.test.ts',
  ],
  passed: 34,
  coverageDelta: '+11.2%',
  riskNotes: ['确认 webhook 幂等键覆盖所有回调类型', '对账任务需告警未匹配单据'],
};

const apiPack: DomainPack = {
  tag: 'API / 文档',
  keywords: ['api', '接口', '文档', 'openapi', 'swagger', 'sdk', 'restful', 'rest'],
  modules: ['apiSchema.ts', 'docGenerator.ts', 'exampleBuilder.ts'],
  testDir: 'tests/api/',
  workflow: 'Schema 提取 + 文档生成 + 示例校验 + Review',
  risks: ['Schema 漂移', '示例失效', '鉴权字段暴露'],
  conflict: '文档生成方式（注解驱动 与 运行时反射）需要择一',
  options: [
    {
      title: 'Option A · 注解 / 类型驱动生成',
      proposedBy: 'Backend Eng A',
      summary: '从类型与装饰器静态提取 Schema，构建期生成 OpenAPI。',
      pros: ['构建期即校验，与代码同源不漂移', '无运行时开销', 'CI 可卡住文档缺失'],
      risks: ['需补齐注解，初期改动面大', '动态路由覆盖有限'],
      impactedFiles: ['apiSchema.ts', 'docGenerator.ts', 'openapi.config.ts'],
      scores: { 落地速度: 7, 可测试性: 9, 安全性: 8, 灵活性: 6 },
      recommended: true,
    },
    {
      title: 'Option B · 运行时反射生成',
      proposedBy: 'Frontend Eng B',
      summary: '启动时反射路由与 handler，运行期动态产出文档。',
      pros: ['零注解、接入快', '天然覆盖动态注册路由'],
      risks: ['运行时开销与启动变慢', '类型信息丢失，示例不准', '易把内部字段暴露到文档'],
      impactedFiles: ['reflectScanner.ts', 'docServer.ts', 'exampleBuilder.ts'],
      scores: { 落地速度: 8, 可测试性: 5, 安全性: 5, 灵活性: 8 },
    },
    {
      title: 'Option C · 混合（静态为主 + 运行时补全）',
      proposedBy: 'Security Audit Agent',
      summary: '静态注解产出主文档，运行时仅补动态路由并做字段脱敏。',
      pros: ['覆盖全 + 与代码同源', '对动态路由友好'],
      risks: ['两条生成链需保持一致', '脱敏规则要单独维护'],
      impactedFiles: ['apiSchema.ts', 'docGenerator.ts', 'reflectScanner.ts', 'redact.config.ts'],
      scores: { 落地速度: 6, 可测试性: 7, 安全性: 7, 灵活性: 8 },
    },
  ],
  discussion: [
    {
      agent: 'Backend Eng A',
      role: '后端工程 Agent',
      accent: 'backend',
      message: '建议注解驱动。文档与类型同源才不会漂移，CI 还能卡住漏写文档的接口。',
    },
    {
      agent: 'Test Agent',
      role: '测试 Agent',
      accent: 'test',
      message: '静态方案示例可由类型生成、可断言；运行时反射的示例经常和真实响应对不上。',
    },
    {
      agent: 'Security Audit Agent',
      role: '安全审查 Agent',
      accent: 'security',
      message: '运行时反射容易把内部字段泄进文档，无论哪种方案都要有字段脱敏白名单。',
    },
  ],
  evidenceRefs: [
    'artifact://review/api-doc-audit-009',
    'artifact://test_log/schema-contract-suite',
    'artifact://diff/annotation-vs-reflection',
    'artifact://context/api-surface-map',
  ],
  riskSignals: [
    'Schema 与实现漂移导致文档失真',
    '示例与真实响应不一致',
    '内部字段意外暴露到公开文档',
  ],
  recommendedReason:
    '文档正确性优先：注解/类型驱动与代码同源、构建期即校验、示例可断言，CI 能拦住缺失文档，长期维护成本最低。',
  changedFiles: [
    'apiSchema.ts',
    'docGenerator.ts',
    'exampleBuilder.ts',
    'schema.contract.test.ts',
    'docGenerator.test.ts',
  ],
  passed: 22,
  coverageDelta: '+6.7%',
  riskNotes: ['为公开文档配置内部字段脱敏白名单'],
};

const FLAVORED_PACKS: DomainPack[] = [authPack, paymentPack, apiPack];

/** 通用兜底包：命中不了具体领域时，用模块猜测 + 集中/分散/混合三方案模板。 */
function genericPack(subject: string): DomainPack {
  return {
    tag: '通用',
    keywords: [],
    modules: ['coreService.ts', 'requestHandler.ts', 'domainModel.ts'],
    testDir: 'tests/',
    workflow: '功能开发 + 测试 + 安全审查 + Review',
    risks: ['边界条件', '并发一致性', '回归影响面'],
    conflict: `"${subject}" 的落地架构（集中式 与 分散式）需要择一`,
    options: [
      {
        title: 'Option A · 集中式（Service 层统一处理）',
        proposedBy: 'Backend Eng A',
        summary: `围绕"${subject}"在 Service 层集中实现，对上暴露单一入口。`,
        pros: ['职责集中、易于测试与审计', '改动面收敛', '便于统一加校验与日志'],
        risks: ['单点逻辑可能膨胀', '跨模块定制需下沉参数'],
        impactedFiles: ['coreService.ts', 'requestHandler.ts', 'domainModel.ts'],
        scores: { 落地速度: 8, 可测试性: 8, 安全性: 8, 灵活性: 6 },
        recommended: true,
      },
      {
        title: 'Option B · 分散式（各模块自治）',
        proposedBy: 'Frontend Eng B',
        summary: `把"${subject}"的逻辑下放到各调用方，按模块各自实现。`,
        pros: ['模块自治、迭代灵活', '无中心瓶颈'],
        risks: ['实现分散、行为易漂移', '重复代码与测试成本高', '统一策略难落地'],
        impactedFiles: ['moduleA.ts', 'moduleB.ts', 'shared/util.ts'],
        scores: { 落地速度: 6, 可测试性: 5, 安全性: 6, 灵活性: 9 },
      },
      {
        title: 'Option C · 混合（核心集中 + 扩展点分散）',
        proposedBy: 'Security Audit Agent',
        summary: '核心逻辑集中在 Service，开放扩展点供模块定制。',
        pros: ['一致性 + 可定制兼顾', '可平滑演进'],
        risks: ['扩展点契约需谨慎设计', '复杂度略高'],
        impactedFiles: ['coreService.ts', 'extensionPoint.ts', 'domainModel.ts'],
        scores: { 落地速度: 6, 可测试性: 7, 安全性: 7, 灵活性: 8 },
      },
    ],
    discussion: [
      {
        agent: 'Backend Eng A',
        role: '后端工程 Agent',
        accent: 'backend',
        message: `"${subject}"建议先集中到 Service 层，行为统一、后续加约束和日志都方便。`,
      },
      {
        agent: 'Test Agent',
        role: '测试 Agent',
        accent: 'test',
        message: '集中实现的用例边界清晰、易断言；分散式要为每个模块重复补测，回归成本高。',
      },
      {
        agent: 'Security Audit Agent',
        role: '安全审查 Agent',
        accent: 'security',
        message: '无论集中还是分散，都要统一校验入参与越权路径，避免各模块各写一套留缺口。',
      },
    ],
    evidenceRefs: [
      'artifact://review/design-review-001',
      'artifact://test_log/regression-suite',
      'artifact://diff/centralized-vs-distributed',
      'artifact://context/domain-model',
    ],
    riskSignals: ['跨模块行为不一致', '并发下的竞态与一致性', '改动波及面评估不足'],
    recommendedReason: `围绕"${subject}"，集中式在一致性、可测试性与可审计性上更稳：单一入口便于统一加约束，回归面可控，是综合风险最低的起点。`,
    changedFiles: [
      'coreService.ts',
      'requestHandler.ts',
      'domainModel.ts',
      'coreService.test.ts',
      'requestHandler.test.ts',
    ],
    passed: 24,
    coverageDelta: '+7.5%',
    riskNotes: [`确认"${subject}"的边界条件与并发路径已覆盖`],
  };
}

// ══════════════════════════════════════════════════
//  组装
// ══════════════════════════════════════════════════

function pickPack(taskText: string, subject: string): DomainPack {
  const t = taskText.toLowerCase();
  const hit = FLAVORED_PACKS.find((p) =>
    p.keywords.some((k) => taskText.includes(k) || t.includes(k)),
  );
  return hit ?? genericPack(subject);
}

function withIds(specs: DomainPack['options']): CouncilOption[] {
  const ids = ['option-a', 'option-b', 'option-c'];
  return specs.map((spec, i) => ({ id: ids[i], ...spec }));
}

/** 需求文本 → 完整演示场景（纯函数，可复现）。 */
export function deriveScenario(taskText: string): Scenario {
  const subject = extractSubject(taskText);
  const pack = pickPack(taskText, subject);
  const options = withIds(pack.options);

  return {
    subject,
    domain: pack.tag,
    understanding: {
      goal: `围绕"${subject}"完成实现并补充对应测试；主要落在 ${pack.modules.join('、')}。`,
      modules: pack.modules,
      testDir: pack.testDir,
      risks: pack.risks,
      workflow: pack.workflow,
    },
    council: {
      context: {
        title: `${pack.conflict}`,
        description: `处理"${subject}"时，${pack.conflict}，需要你裁决。`,
        decisionMode: 'delegated_decision',
        councilId: `COUNCIL-${hash4(taskText)}`,
      },
      discussion: pack.discussion,
      options,
      evidenceRefs: pack.evidenceRefs,
      riskSignals: pack.riskSignals,
      recommendedReason: pack.recommendedReason,
    },
    delivery: {
      summary: `已完成"${subject}"，采用 ${options[0].title.replace(/^Option A · /, '')}，并补充相关测试与安全审查。`,
      changedFiles: pack.changedFiles,
      testResult: { passed: pack.passed, failed: 0, coverageDelta: pack.coverageDelta },
      riskNotes: pack.riskNotes,
    },
  };
}

/** 在场景内按 id 取议会方案（替代原 getCouncilOption）。 */
export function findOption(scenario: Scenario, id: string | null): CouncilOption | undefined {
  if (!id) return undefined;
  return scenario.council.options.find((o) => o.id === id);
}

// ══════════════════════════════════════════════════
//  团队推荐（对齐方向 C · N1 Triage「建议角色」）
// ══════════════════════════════════════════════════
//
// 语义归属：读需求 → 建议角色/组队，是 C 的 N1 分诊职责（推荐依据可参考 B 的
// persona/metrics）。此处按需求领域给出建议的 Agent 组合；用户仍可在 Agent Board
// 自定义增删。agent id 对应 src/data/agents.ts 的固定 Agent 池。

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
  const subject = extractSubject(taskText);
  const pack = pickPack(taskText, subject);
  const base = TEAM_BY_TAG[pack.tag] ?? TEAM_BY_TAG['通用'];
  const ids = [...base.ids];
  const t = taskText.toLowerCase();
  const needFrontend = UI_KEYWORDS.some((k) => taskText.includes(k) || t.includes(k));
  if (needFrontend && !ids.includes('frontend-b')) ids.push('frontend-b');
  const reason = needFrontend ? `${base.reason} · 前端联调受控 UI` : base.reason;
  return { ids, reason };
}

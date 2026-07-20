import { describe, expect, it } from 'vitest';
import { recommendAgents } from '@/data/agentRecommendation';

/**
 * `recommendAgents` 的行为锁。
 *
 * 它是「需求文本 → 建议 Agent 团队」的客户端启发式（N1 分诊的展示层），
 * 从原 data/scenario.ts 搬过来时**不许改行为** —— 这组用例先按搬家前的实现写死，
 * 搬完再跑一遍，绿了才算等价。
 */
describe('recommendAgents · 领域命中', () => {
  it('空需求不推荐任何人（新项目未输入需求前团队保持为空）', () => {
    expect(recommendAgents('')).toEqual({ ids: [], reason: '' });
    expect(recommendAgents('   \n  ')).toEqual({ ids: [], reason: '' });
  });

  it('权限/鉴权：安全审查排在测试前面', () => {
    const rec = recommendAgents('为订单接口增加基于角色的权限校验');
    expect(rec.ids).toEqual(['backend-a', 'security-agent', 'test-agent']);
    expect(rec.reason).toContain('权限任务');
  });

  it('支付/计费：测试排在安全审查前面', () => {
    const rec = recommendAgents('接入 Stripe 完成订阅扣款与退款');
    expect(rec.ids).toEqual(['backend-a', 'test-agent', 'security-agent']);
    expect(rec.reason).toContain('支付任务');
  });

  it('API/文档', () => {
    const rec = recommendAgents('给用户服务补一份 OpenAPI 文档');
    expect(rec.ids).toEqual(['backend-a', 'test-agent', 'security-agent']);
    expect(rec.reason).toContain('API/文档任务');
  });

  it('命中不了具体领域 → 通用包', () => {
    const rec = recommendAgents('把日志格式统一成 JSON');
    expect(rec.ids).toEqual(['backend-a', 'test-agent', 'security-agent']);
    expect(rec.reason).toContain('通用任务');
  });

  it('关键词大小写不敏感（英文关键词走 toLowerCase 比对）', () => {
    expect(recommendAgents('add OAuth login').reason).toContain('权限任务');
    expect(recommendAgents('fix PAYMENT webhook').reason).toContain('支付任务');
  });

  it('首个命中的领域包胜出（权限包排在支付包之前）', () => {
    // 同时含「权限」与「支付」→ 按 FLAVORED_PACKS 顺序取权限包
    expect(recommendAgents('支付模块的权限校验').reason).toContain('权限任务');
  });
});

describe('recommendAgents · 前端加派', () => {
  it('命中 UI 关键词时追加前端 Agent，并在理由后缀说明', () => {
    const rec = recommendAgents('新增一个权限管理页面，含表单与弹窗');
    expect(rec.ids).toEqual(['backend-a', 'security-agent', 'test-agent', 'frontend-b']);
    expect(rec.reason).toContain('前端联调受控 UI');
  });

  it('通用需求命中 UI 关键词同样加派', () => {
    const rec = recommendAgents('调整列表页的布局');
    expect(rec.ids).toContain('frontend-b');
    expect(rec.ids[rec.ids.length - 1]).toBe('frontend-b');
  });

  it('没有 UI 关键词就不加派，理由也不带后缀', () => {
    const rec = recommendAgents('重构结算服务的对账逻辑');
    expect(rec.ids).not.toContain('frontend-b');
    expect(rec.reason).not.toContain('前端联调');
  });
});

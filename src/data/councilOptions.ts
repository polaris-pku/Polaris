import type { CouncilVerdict } from '@/types';
import { UI_TO_CONTRACT_COUNCIL_VERDICT } from '@/api/map';

// 议会的具体裁决场景（分歧描述、三个候选方案、讨论、证据、风险信号）已改为
// 按需求文本动态推导，见 src/data/scenario.ts。本文件仅保留与场景无关的
// verdict 元数据（裁决类型 → 落点 + 收敛到后端契约的 verdict）。

/**
 * 裁决类型 → 人话标签 + 落点。
 *
 * 原来这里的 `label` 是 `select · 采纳方案` 这类双语枚举，`landing` 是 `→ reviewing →
 * MergeAuthorization` 这类协议原文 —— 两者都在主层说协议话（F2）。协议枚举本身仍然在
 * `id` 上（它要经 `src/api/map.ts` 收敛到后端契约），只是不再直接渲染给人看。
 *
 * `variant` 绑的是新的 4 个强调色：合议 = 「轮到人裁决」→ 并入 human（原来的紫色色相已删除）。
 */
const verdictBase: {
  id: CouncilVerdict;
  label: string;
  desc: string;
  landing: string;
  variant: 'default' | 'command' | 'human' | 'danger';
}[] = [
  {
    id: 'select',
    label: '采纳方案',
    desc: '采纳选中方案；后续自动生成合并授权，主流程继续。',
    landing: '继续到合并授权',
    variant: 'command',
  },
  {
    id: 'needs_human',
    label: '需要人工',
    desc: '证据不足以自动决策，升级人工补充输入。',
    landing: '等待你补充输入',
    variant: 'human',
  },
  {
    id: 'request_revision',
    label: '打回修订',
    desc: '方案需返工，任务回到阻断态等待重新执行。',
    landing: '任务阻断，等待重做',
    variant: 'danger',
  },
  {
    id: 'reject',
    label: '拒绝',
    desc: '拒绝全部方案，本轮不进入合并。',
    landing: '任务阻断，本轮不合并',
    variant: 'danger',
  },
];

/**
 * verdictDefs：在展示定义上附加 `contract` —— 经 src/api/map 收敛到后端契约
 * CouncilDecision.verdict（accept/reject/defer）。此处真实引用桥接映射，
 * 使后端 Council 契约漂移能在编译期咬住前端。
 */
export const verdictDefs = verdictBase.map((def) => ({
  ...def,
  contract: UI_TO_CONTRACT_COUNCIL_VERDICT[def.id],
}));

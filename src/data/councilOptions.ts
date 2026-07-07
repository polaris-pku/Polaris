import type { CouncilVerdict } from '@/types';
import { UI_TO_CONTRACT_COUNCIL_VERDICT } from '@/api/map';

// 议会的具体裁决场景（分歧描述、三个候选方案、讨论、证据、风险信号）已改为
// 按需求文本动态推导，见 src/data/scenario.ts。本文件仅保留与场景无关的
// verdict 元数据（裁决类型 → 落点 + 收敛到后端契约的 verdict）。

/** N14 verdict 四种取值 → C 侧状态落点（字段清单 §2 决策映射） */
const verdictBase: {
  id: CouncilVerdict;
  label: string;
  desc: string;
  landing: string;
  variant: 'amber' | 'violet' | 'red' | 'slate';
}[] = [
  {
    id: 'select',
    label: 'select · 采纳方案',
    desc: '采纳选中方案；delegated 模式下生成 MergeAuthorization 继续主流程。',
    landing: '→ reviewing → MergeAuthorization',
    variant: 'violet',
  },
  {
    id: 'needs_human',
    label: 'needs_human · 需人工',
    desc: '证据不足以自动决策，升级人工补充输入。',
    landing: '→ waiting_input',
    variant: 'amber',
  },
  {
    id: 'request_revision',
    label: 'request_revision · 打回修订',
    desc: '方案需返工，任务回到阻断态等待重新执行。',
    landing: '→ blocked',
    variant: 'red',
  },
  {
    id: 'reject',
    label: 'reject · 拒绝',
    desc: '拒绝全部方案，本轮不进入合并。',
    landing: '→ blocked / reject',
    variant: 'red',
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

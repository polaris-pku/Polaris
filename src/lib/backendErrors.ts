/**
 * 后端错误码 → 人话 + 可操作建议。
 *
 * BCD 的 `RunError.message` 是给开发者看的（"No artifact was selected"），
 * 直接甩给用户等于让人对着一个红色 failed 发呆。这里把已知错误码翻译成
 * 「发生了什么 + 你该怎么做」。
 *
 * 未知错误码不编造解释 —— 原样透出后端的 code/message，宁可干巴巴也不要误导。
 */
import type { RunError } from '@/api/types/rpc';

export type ExplainedError = {
  /** 一句话说清发生了什么 */
  title: string;
  /** 用户下一步能做什么；无可操作建议时为 undefined */
  hint?: string;
  /** 后端原始 code，始终保留（排查时要用） */
  code: string;
  /** 后端原始 message，始终保留 */
  raw: string;
  /** 是否是「用户可以自己修好」的问题（而非系统故障） */
  actionable: boolean;
};

const EXPLANATIONS: Record<string, Omit<ExplainedError, 'code' | 'raw'>> = {
  // 最常见的一个：需求是闲聊/问答，agent 没改任何文件 → 没有 diff → 没有产物。
  // 这不是故障，是 BCD 要求每个 run 至少产出一个代码产物。
  ARTIFACT_NOT_SELECTED: {
    title: '这个需求没有产生任何代码改动',
    hint: '后端要求每次执行都要产出代码产物。纯问答／闲聊类的需求（如「你是谁」）会走到这里。请换成一个具体的编码任务，例如「创建 src/utils/format.ts，实现 formatBytes(n) 并加单元测试」。',
    actionable: true,
  },
  DRIVER_FAILED: {
    title: 'Agent 没能完成执行',
    // 最常见的原因是**没配 API key**。AuthBanner 本该在提交前就拦住，
    // 但 key 失效/额度用尽也会走到这里 —— 所以这里也要把认证摆在第一位。
    hint: 'agent 进程被拉起但执行失败。最常见的原因是 API key 缺失、失效或额度用尽 —— 打开右上角「设置 → Agent 认证」检查。其次是工作区不可写。',
    actionable: true,
  },
  EXTERNAL_DRIVER_TRANSPORT_ERROR: {
    title: '无法与 Agent 进程通信',
    hint: 'ACP runner 起不来或异常退出。桌面版请在「设置」里确认 agent 认证已配置；开发环境请检查 Node 版本（需 22.22.1+）。',
    actionable: true,
  },
  GATE_DENIED: {
    title: 'Gate 拒绝了本次改动',
    hint: '策略判定这次产出不可合入。查看下方事件流里的 gate.result 了解拒绝理由。',
    actionable: false,
  },
};

export function explainError(error: RunError): ExplainedError {
  const known = EXPLANATIONS[error.code];
  if (known) {
    return { ...known, code: error.code, raw: error.message };
  }
  // 未知码：不编造，原样透出。
  return {
    title: error.message,
    code: error.code,
    raw: error.message,
    actionable: false,
  };
}

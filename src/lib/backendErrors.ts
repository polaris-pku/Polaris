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
  // 后端要求每个 run 至少产出一个代码产物（diff）。走到这里有两种情况，文案都要覆盖：
  // (a) 需求本就是问答/解释类，agent 正常回答了、无需落盘；
  // (b) 需求确实要代码，但 agent 把代码贴在了回复里、**没有调用写文件工具**（同一句话有时写、
  //     有时不写，是模型当场的随机选择，不该让用户靠斟酌措辞去兜底）。
  ARTIFACT_NOT_SELECTED: {
    title: 'agent 只给了回复，没有把文件写进工作区',
    hint: '本次执行没有产生任何文件改动。可能是需求本身是问答／解释类（无需落盘），也可能是 agent 把代码写在了回复里却没调用写文件工具。如果你要的是文件，在需求里点明「请创建 xxx 并写入实现」通常更稳，或直接重试一次。',
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

/**
 * 全应用**唯一**的 run 状态判定。
 *
 * 在此之前，同一个状态有四套互相冲突的词表（TaskBoard / AppShell / ProjectTree 各一份，
 * StatusPill 另有 11 个双语态），而真实 run 的 `liveRun.status` 其实只有 4 态。
 *
 * 规则：**UI 永不直接渲染 `DemoStage`**（它是 mock 执行引擎的内部枚举），一律走 `runStateOf()`。
 */
import type { RunEvent } from '@/api/types/rpc';
import type { LiveRunState } from '@/store/types';
import type { DemoTask } from '@/types';

export type RunState =
  | 'idle'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unsent';

/** 唯一的中文词表。别处不许再写第二份。 */
export const RUN_STATE_LABEL: Record<RunState, string> = {
  idle: '未开始',
  running: '执行中',
  blocked: '需要你',
  completed: '已交付',
  failed: '失败',
  cancelled: '已取消',
  unsent: '未提交到后端',
};

/** 颜色只编码状态：机器在动 / 需要你 / 成功 / 失败 / 无。 */
export const RUN_STATE_TONE: Record<RunState, 'muted' | 'command' | 'human' | 'ok' | 'danger'> = {
  idle: 'muted',
  running: 'command',
  blocked: 'human',
  completed: 'ok',
  failed: 'danger',
  cancelled: 'muted',
  unsent: 'danger',
};

/** Gate 的四个分支里，只有这两个意味着「停下来，需要人」。 */
const BLOCKING_GATE_DECISIONS = new Set(['ask', 'defer']);

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** 时间线里最后一次 Gate 结论（没有 Gate 事件则为空串）。 */
function latestGateDecision(timeline: RunEvent[]): string {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const event = timeline[i];
    if (event.type !== 'gate.result') continue;
    const decision = asRecord(event.payload).decision;
    return typeof decision === 'string' ? decision : '';
  }
  return '';
}

/**
 * 唯一的状态判定。
 *
 * `task` 有 `contractRunId` 却没有对应的 `live`（事件还没到 / 通道刚建立）时，如实按「执行中」处理：
 * `run.create` 是「建 Task + Run 并立刻开跑」，后端已经受理了 —— 报「未开始」会让用户以为可以再点一次
 * 「开始执行」，从而重复提交同一个需求。
 */
export function runStateOf(task: DemoTask | undefined, live: LiveRunState | undefined): RunState {
  if (!task) return 'idle';

  // 后端没受理这个需求（run.create 失败）→ 它只是个本地任务。这是一个**错误**，不是一个中性状态。
  if (!task.contractRunId) return task.submitError ? 'unsent' : 'idle';

  if (!live) return 'running';

  switch (live.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'running':
      return BLOCKING_GATE_DECISIONS.has(latestGateDecision(live.timeline)) ? 'blocked' : 'running';
  }
}

/**
 * 主层词表。
 *
 * 规则（F2）：主层只说人话；协议词（`mailbox.message_sent` / `event_id` / `gate.decision=defer`）
 * 只允许活在 L3 —— Dock 的事件流频道 —— 以及 D2 里作为灰色注解。
 */
import type { PhaseKey } from '@/data/workflow';

/** Dock 的三个频道。它是 L3 的唯一物理出口。 */
export type DockChannel = 'terminal' | 'events' | 'runtimes';

export const DOCK_CHANNEL_LABEL: Record<DockChannel, string> = {
  terminal: '终端',
  events: '事件流',
  runtimes: '运行时',
};

/** 进度缎带的四段，顺序固定。 */
export const PHASE_ORDER: readonly PhaseKey[] = ['intake', 'execution', 'review', 'delivery'];

/**
 * `review` 是「审查」不是「评审」：这一步实际是 Gate + hook 的**自动**检查，
 * 不是人做的 code review。（`eventGraph.STEPS.review.labelCn` 一直是「审查」，是 PHASES 在漂移。）
 */
export const PHASE_LABEL: Record<PhaseKey, string> = {
  intake: '受理',
  execution: '执行',
  review: '审查',
  delivery: '交付',
};

/** 帮助抽屉的文档目录（id 对应 src/docs/<id>.md）。 */
export const HELP_TOPICS: { id: string; title: string }[] = [
  { id: 'overview', title: '总览' },
  { id: 'python-terminal', title: 'Python 终端' },
  { id: 'protocol', title: '协议参考' },
];

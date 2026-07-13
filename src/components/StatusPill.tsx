import type { AgentStatus, WorkflowNodeStatus } from '@/types';
import { Badge, type BadgeProps } from '@/components/ui/Badge';

type Tone = NonNullable<BadgeProps['variant']>;

/**
 * 状态徽章。
 *
 * 原来这里有 19 个双语枚举（`running · 执行中`）—— 英文那一半是协议枚举，它只描述后端的
 * 状态机，不描述「我的任务怎么样了」。主层只说人话（F2），协议原文活在 L3。
 *
 * 原来的 `TaskStatusPill`（11 个协调器核心态）也一并删除：它唯一的宿主 `NodeInspector`
 * 已经不存在，而那 11 个态里的等待类枚举本来就只允许出现在 Dock 的事件流频道里（L3）。
 */

/** Agent 生命周期 → 人话 + 状态色。颜色只编码状态：在岗=ok，收尾=需要留意(human)，其余中性。 */
const agentStatusMap: Record<AgentStatus, { label: string; tone: Tone }> = {
  created: { label: '已建档', tone: 'default' },
  active: { label: '在岗', tone: 'ok' },
  idle: { label: '空闲', tone: 'default' },
  draining: { label: '收尾中', tone: 'human' },
  retired: { label: '已退休', tone: 'default' },
};

/** 步骤状态 → 人话 + 状态色（原 nodeStatusMap，合并到这里，全应用唯一一份）。 */
const nodeStatusMap: Record<WorkflowNodeStatus, { label: string; tone: Tone }> = {
  pending: { label: '待执行', tone: 'default' },
  active: { label: '执行中', tone: 'command' },
  done: { label: '已完成', tone: 'ok' },
  blocked: { label: '已阻塞', tone: 'danger' },
  updated: { label: '已被介入', tone: 'human' },
};

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  const s = agentStatusMap[status];
  return <Badge variant={s.tone}>{s.label}</Badge>;
}

export function NodeStatusPill({ status }: { status: WorkflowNodeStatus }) {
  const s = nodeStatusMap[status];
  return <Badge variant={s.tone}>{s.label}</Badge>;
}

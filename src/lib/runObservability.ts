import type { RunAgentActivity, RunCursor } from '@/api/types/observability';
import type { RunEvent, RunSnapshot } from '@/api/types/rpc';
import { BackendError } from '@/api/transport';
import { PAYLOAD_REF_UNAVAILABLE_CODE } from '@/api/types/observability';

export const RUN_CURSOR_LABELS: Record<RunCursor, string> = {
  select_agent: '选择执行角色',
  execute_agent: '执行任务',
  council: '议会协作',
  gate: '检查交付条件',
  deliver: '交付产物',
  mailbox_wait: '等待协作回复',
  done: '阶段流程结束',
};

export function stageLabel(stage: string): string {
  return Object.prototype.hasOwnProperty.call(RUN_CURSOR_LABELS, stage)
    ? RUN_CURSOR_LABELS[stage as RunCursor]
    : stage === 'unattributed'
      ? '未归属阶段'
      : stage === 'driver_stream'
        ? '执行器事件'
        : stage;
}

export function agentActivityLabel(agent: RunAgentActivity): string {
  if (agent.state === 'thinking') return '正在思考';
  if (!agent.driver) return '已委派执行';
  switch (agent.driver.state) {
    case 'turn_running':
      return '执行器正在处理';
    case 'tool_running': {
      const tool = agent.driver.tool_title || agent.driver.tool_name || agent.driver.tool_kind;
      return tool ? `正在执行工具 · ${tool}` : '正在执行工具';
    }
    case 'disconnected':
      return '执行器已断开';
  }
}

export function observedRoleIds(
  snapshot: RunSnapshot | null,
  timeline: readonly RunEvent[],
): string[] {
  const roles = new Set<string>();
  if (snapshot?.task?.role_id) roles.add(snapshot.task.role_id);
  for (const agent of snapshot?.activity?.agents ?? []) roles.add(agent.role_id);
  for (const session of snapshot?.usage?.context?.sessions ?? []) {
    if (session.role_id) roles.add(session.role_id);
  }
  for (const event of timeline) {
    if (typeof event.payload.role_id === 'string' && event.payload.role_id) {
      roles.add(event.payload.role_id);
    }
  }
  return [...roles];
}

export function observationError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.code === -32601) return '当前后端不支持此接口，请更新后端后重试（-32601）。';
    if (error.code === PAYLOAD_REF_UNAVAILABLE_CODE) {
      return '原始载荷不可用，可能已被截断或清理（-32017）。';
    }
    if (error.code === -32004) return '后端找不到这次运行（-32004）。';
    if (error.code === -32602) return '后端拒绝了查询参数（-32602）。';
  }
  return error instanceof Error ? error.message : String(error);
}

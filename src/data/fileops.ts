import type { FileOpObservation, FilePermissionOutcome } from '@/api/types';

/**
 * 文件操作观测流的取用 helper。
 *
 * 真实 run 的文件操作来自后端（replay.nodeFileOps，由 A 的 ACP 工具事件派生）。
 * 这里只保留按节点 id / 路径 / tool_event_id 取用的纯函数；没有 run 就没有观测流
 * （空表兜底，一律返回空/ null）。合成渲染态由 fileOpsForNode 叠加人机确认结果。
 */

/** 节点文件操作观测流的空表兜底（真实数据经 fileOpsForNode 的 script 参数传入）。 */
export const nodeFileOps: Record<string, FileOpObservation[]> = {};

/** 按项目内路径反查 agent 生成的文件内容（无 run 数据时返回 null，由查看页回退到磁盘）。 */
export function agentContentForPath(
  filePath: string,
  script: Record<string, FileOpObservation[]> = nodeFileOps,
): string | null {
  let content: string | null = null;
  for (const ops of Object.values(script)) {
    for (const op of ops) {
      if (op.method === 'fs/write_text_file' && op.path === filePath && op.content != null) {
        content = op.content;
      }
    }
  }
  return content;
}

/** 按 tool_event_id 反查观测条目及其所属节点（权限确认后定位要落盘的那条写操作）。 */
export function findFileOp(
  toolEventId: string,
  script: Record<string, FileOpObservation[]> = nodeFileOps,
): { nodeId: string; op: FileOpObservation } | null {
  for (const [nodeId, ops] of Object.entries(script)) {
    const op = ops.find((o) => o.tool_event_id === toolEventId);
    if (op) return { nodeId, op };
  }
  return null;
}

/**
 * 合成渲染态：把人机确认结果（store 持久化）叠加回观测流。
 * 权限请求被确认后，该操作视为完成（拒绝则 failed）。status 的真相来自 A 的工具事件。
 */
export function fileOpsForNode(
  nodeId: string,
  outcomes: Record<string, FilePermissionOutcome>,
  script: Record<string, FileOpObservation[]> = nodeFileOps,
): FileOpObservation[] {
  const ops = script[nodeId];
  if (!ops) return [];
  return ops.map((o) => {
    const outcome = outcomes[o.tool_event_id];
    if (!o.permission || !outcome) return o;
    return {
      ...o,
      permission_outcome: outcome,
      status:
        outcome.outcome === 'selected' && outcome.optionId !== 'reject' ? 'completed' : 'failed',
    };
  });
}

import type { FileOpObservation, FilePermissionOutcome } from '@/api/types';
import type { Project } from '@/types';
import { fileOpsForNode } from '@/data/fileops';
import { writeAgentFile, type AgentFileWriteResult, type AgentWriteTarget } from '@/lib/agentFs';

/**
 * Agent 写操作的落盘调度（store/lib 共享）。
 *
 * 两个触发点共用同一入口：
 *   - executionSlice.nextStep —— N7 节点整列点亮时，落盘该节点上 gate:allow 的写操作；
 *   - interventionSlice.resolveFilePermission —— 人确认"允许"后，落盘被挂起的那条。
 * 先同步记 pending 占位（防两个触发点重复写），异步完成后回写真实结果。
 */

/** 一条观测是否已获准落盘：写方法 + 带内容 + （无权限请求，或人已选择非拒绝项）。 */
function isApprovedWrite(op: FileOpObservation): boolean {
  if (op.method !== 'fs/write_text_file' || op.content == null) return false;
  if (!op.permission) return true;
  const outcome = op.permission_outcome;
  return !!outcome && outcome.outcome === 'selected' && outcome.optionId !== 'reject';
}

/** 从项目导出写入目标：自定义根目录（用户授权路径）优先，缺省落默认工作区/<项目名>。 */
export function writeTargetOf(project: Project | undefined): AgentWriteTarget {
  return { projectName: project?.name ?? 'default', rootPath: project?.rootPath };
}

/** 落盘某节点上所有获准且尚未处理的写操作（fire-and-forget，结果经 record 回写 store）。 */
export function flushAgentWritesForNode(
  nodeId: string,
  outcomes: Record<string, FilePermissionOutcome>,
  written: Record<string, AgentFileWriteResult>,
  target: AgentWriteTarget,
  record: (toolEventId: string, result: AgentFileWriteResult) => void,
): void {
  fileOpsForNode(nodeId, outcomes)
    .filter((op) => isApprovedWrite(op) && !written[op.tool_event_id])
    .forEach((op) => {
      record(op.tool_event_id, { status: 'pending' });
      void writeAgentFile(op, target).then((result) => record(op.tool_event_id, result));
    });
}

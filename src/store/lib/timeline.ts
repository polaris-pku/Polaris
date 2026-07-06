import type { LogEntry, TimelineCheckpoint, TimelineEvent } from '@/types';
import { nodeLogs } from '@/data/logs';
import { captureSnapshot, nextTimelineId } from '@/lib/snapshot';
import type { PartialExecState } from '@/store/types';

/** 并行节点 id 形如 `<原id>-be|-te`，剥去后缀以复用同 code 的日志/资源 */
const stripParallelSuffix = (id: string) => id.replace(/-(be|te)$/, '');

/** 取节点对应的时间线日志（并行分身回落到主节点的日志）。 */
export const getNodeLog = (id: string) => nodeLogs[id] ?? nodeLogs[stripParallelSuffix(id)];

/** 由日志条目 + 当次执行态构造一条可回退的时间线事件（含快照）。 */
export function buildTimelineEvent(
  entry: LogEntry,
  exec: PartialExecState,
  checkpoint?: TimelineCheckpoint,
): TimelineEvent {
  return {
    id: nextTimelineId(),
    ...entry,
    checkpoint,
    snapshot: captureSnapshot(exec),
  };
}

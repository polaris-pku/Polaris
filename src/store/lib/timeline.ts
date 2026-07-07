import type { LogEntry, RunReplay, TimelineCheckpoint, TimelineEvent } from '@/types';
import { nodeLogs } from '@/data/logs';
import { stripExecSuffix } from '@/data/workflow';
import { captureSnapshot, nextTimelineId } from '@/lib/snapshot';
import type { PartialExecState } from '@/store/types';

/**
 * 取节点对应的时间线日志（执行子链分身回落到基础节点的日志）。
 * 带 replay 的任务只用真实 run 的回放文案（不回落 mock 剧本，避免场景串场；
 * 回放数据缺失的节点即视为本次 run 无记录）。
 */
export const getNodeLog = (id: string, replay?: RunReplay) =>
  replay
    ? (replay.nodeLogs[id] ?? replay.nodeLogs[stripExecSuffix(id)])
    : (nodeLogs[id] ?? nodeLogs[stripExecSuffix(id)]);

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

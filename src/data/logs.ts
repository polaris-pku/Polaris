import type { LogEntry, TimelineCheckpoint } from '@/types';

/**
 * 节点执行时间轴日志的来源。
 *
 * 真实 run 的节点日志来自后端事件（见 lib/liveReplay.ts 的 nodeLogs），不在此文件；
 * 消费方（store/lib/timeline.ts 的 getNodeLog）以 replay 为准，没有 run 即无日志。
 * 这里保留一个空表以兼容旧的按节点 id 取用的调用点（一律返回 undefined → 无日志）。
 */
export const nodeLogs: Record<string, LogEntry & { checkpoint?: TimelineCheckpoint }> = {};

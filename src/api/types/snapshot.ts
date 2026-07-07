/**
 * 方向 C · 前端 Run 快照 —— 对齐 BCD `.newide/runs/<run_id>/frontend-snapshot.json`
 * （`snapshot_type: coordinator.frontend_run_snapshot.v0`）。
 *
 * 这是后端为前端聚合的自包含 run 视图：run 元信息 + 事件时间线 + 交付报告 +
 * 产物 + Checkpoint + mailbox 消息流，`links` 指向 runs 目录下的细粒度文件
 * （result/summary/timeline/checkpoint/message-thread）。拿到这一个文件即可
 * 渲染整个 run。形状以实际落盘样例 run_be712da2 为准（api/ 下的 zip）。
 */

import type {
  ArtifactId,
  ArtifactType,
  CheckpointId,
  DriverId,
  MessageId,
  MessageRecipient,
  RunId,
  SchemaVersion,
  TaskId,
  ThreadId,
  Timestamp,
} from './core';
import type {
  CheckpointTrigger,
  CheckpointType,
  CheckpointValidity,
  MechanicalSnapshot,
  RunStatus,
  RuntimeStateSnapshot,
  SemanticHandoff,
  TaskStatus,
} from './coord';

/** 快照声明的当前阶段（观测到 delivery；词表未冻结，保持开放）。 */
export type RunSnapshotStage = 'intake' | 'execution' | 'review' | 'delivery' | (string & {});

/** run 的执行模式（v0 观测到 single_agent）。 */
export type RunMode = 'single_agent' | 'multi_agent' | (string & {});

/** 时间线条目的展示级别 / 来源（开放词表，样例中为 info|success 与三种来源）。 */
export type RunTimelineLevel = 'info' | 'success' | 'warning' | 'error' | (string & {});
export type RunTimelineSource = 'Coordinator' | 'Driver' | 'Gate' | (string & {});

/**
 * 快照 timeline 的一条事件（也是 runs 目录 timeline.json 条目的详情版）。
 * 注意：条目本身不带时间戳（v0 已知形状），排序即发生顺序。
 */
export interface RunTimelineEntry {
  /** 事件主体 id（task/run/event/artifact/checkpoint id 混用，以 name 区分语义） */
  id: string;
  /** 事件名，如 TaskCreated / MailboxMessageSent (task.assigned) / GateResult */
  name: string;
  level: RunTimelineLevel;
  source: RunTimelineSource;
  text: string;
}

/** 快照 `current`：前端定位「现在该亮哪个节点」的最小指针。 */
export interface RunSnapshotCurrent {
  stage: RunSnapshotStage;
  task_status: TaskStatus;
  /** 直接对齐 N0–N18 节点编号（如 N18） */
  active_node_code: string;
}

/** 快照 `run`：run 元信息。 */
export interface RunSnapshotRun {
  run_id: RunId;
  task_id: TaskId;
  status: RunStatus;
  mode: RunMode;
  driver_id: DriverId;
  created_at: Timestamp;
}

/** 快照 `delivery_report`：交付结果汇总。 */
export interface RunDeliveryReport {
  worktree_path: string;
  files_written: string[];
  artifacts_materialized: number;
  driver_diagnostics: {
    driver_id: DriverId;
    duration_ms: number;
  };
}

/** 快照 `artifacts[]`：产物引用（比 core 的 ArtifactRef 多物化落点、少 producer）。 */
export interface RunArtifact {
  artifact_id: ArtifactId;
  type: ArtifactType;
  uri: string;
  /** 产物内容的原始来源路径（后端本机绝对路径，内容不随快照携带） */
  source_path: string;
  /** 物化到 worktree 的记录文件路径 */
  materialized_record_path: string;
}

/**
 * 快照内嵌的 Checkpoint 视图（完整版见 runs 目录 checkpoint.json / coord.Checkpoint）。
 * 后三个可选字段快照内嵌视图不携带、checkpoint.json 才有——两处都是后端落盘产物，
 * 前端拿到哪份就展示哪份。
 */
export interface RunCheckpointView {
  checkpoint_id: CheckpointId;
  trigger: CheckpointTrigger;
  validity_status: CheckpointValidity;
  semantic_handoff: SemanticHandoff;
  mechanical_snapshot: MechanicalSnapshot;
  checkpoint_type?: CheckpointType;
  runtime_state?: RuntimeStateSnapshot;
  artifact_refs?: ArtifactId[];
}

/**
 * mailbox 消息类型：coordinator ↔ driver 的控制面词表
 * （与 coord.AgentMessageType 的 agent 间协作词表不同域，保持开放）。
 */
export type RunMailboxMessageType =
  | 'task.assigned'
  | 'driver.requested'
  | 'driver.completed'
  | (string & {});

/** mailbox 消息（形状同 coord.Message，type 换用控制面词表）。 */
export interface RunMailboxMessage {
  message_id: MessageId;
  thread_id: ThreadId;
  from_agent_id: string;
  to: MessageRecipient[];
  type: RunMailboxMessageType;
  payload: Record<string, unknown>;
  requires_ack: boolean;
  deadline_seconds?: number;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/** 快照 `mailbox`：thread + 完整消息（message_refs 为 id 索引）。 */
export interface RunMailbox {
  thread_id: ThreadId;
  message_refs: MessageId[];
  messages: RunMailboxMessage[];
}

/** 快照 `links`：runs 目录下各细粒度文件的相对路径索引。 */
export interface RunSnapshotLinks {
  result_path: string;
  summary_path: string;
  timeline_path: string;
  checkpoint_path: string;
  message_thread_path: string;
  frontend_snapshot_path: string;
}

/** 前端 Run 快照全量形状（frontend-snapshot.json 顶层）。 */
export interface FrontendRunSnapshot {
  snapshot_type: 'coordinator.frontend_run_snapshot.v0';
  schema_version: SchemaVersion;
  generated_at: Timestamp;
  run_id: RunId;
  task_id: TaskId;
  current: RunSnapshotCurrent;
  run: RunSnapshotRun;
  timeline: RunTimelineEntry[];
  delivery_report: RunDeliveryReport;
  artifacts: RunArtifact[];
  checkpoint: RunCheckpointView;
  mailbox: RunMailbox;
  links: RunSnapshotLinks;
}

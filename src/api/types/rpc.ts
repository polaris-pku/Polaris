/**
 * BCD 后端 RPC 契约镜像（**最新**：`frontend-workflow.v0.1`）。
 *
 * 逐字对齐 `packages/newide-bcd/src/protocol/{run-event,run-snapshot}.ts`。
 * 这是前端与后端之间**唯一活的契约** —— 后端改了这里就要跟着改，`tsc` 会咬住。
 *
 * 注意与 ./snapshot.ts 的区别：那个建模的是 BCD 落盘的 `frontend-snapshot.json`
 * （`coordinator.frontend_run_snapshot.v0`，供 mock 剧本回放用）；本文件建模的是
 * `run.getSnapshot` 通过 RPC 实时返回的形状。两者不同，不要混用。
 */

/** run.event 的来源方向（由 event.type 前缀推导，见后端 projectRunEventSource）。 */
export type RunEventSource = 'coordinator' | 'agent' | 'driver' | 'memory' | 'gate' | 'council';

/** 后端推给前端的单条流程事件。`sequence` 单调递增，用于去重与排序。 */
export interface RunEvent {
  event_id: string;
  sequence: number;
  run_id: string;
  task_id: string;
  type: string;
  source: RunEventSource;
  created_at: string;
  payload: Record<string, unknown>;
  payload_ref?: string;
  schema_version: string;
}

/** 协调器任务态（比前端展示词表更细，映射见 ../map.ts）。 */
export type RpcTaskStatus =
  | 'created'
  | 'triaged'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'waiting_input'
  | 'waiting_help'
  | 'pending_gate'
  | 'pending_council'
  | 'reviewing'
  | 'blocked'
  | 'escalated'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunMode = 'single_agent' | 'council';
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunStage = 'executing' | 'council' | 'delivery' | 'intervention';

/** 流程图节点态（N0–N18 固定 19 项）。 */
export interface RunNodeStatus {
  code: string;
  status: 'pending' | 'active' | 'done' | 'blocked' | 'updated';
  event_type?: string;
  event_id?: string;
  [key: string]: unknown;
}

export interface RunError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * run.getSnapshot 的返回。
 *
 * **形状是双态的**：只有跑到足够远的 run 才带 contract_version / task / run / flow /
 * delivery_report / links；早期被取消的 run 只有瘦字段。用 `isFrontendWorkflowV01`
 * 守卫后再访问那些字段。
 */
export interface RunSnapshot {
  contract_version?: 'frontend-workflow.v0.1';
  schema_version: string;
  run_id: string;
  task_id: string;
  mode: RunMode;
  status: RunStatus;
  current: {
    stage: RunStage;
    active_node_code: string;
    task_status?: string;
  };
  task?: {
    task_id: string;
    status: RpcTaskStatus;
    spec: string;
    completion_criteria: string[];
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    affected_paths: string[];
    role_id?: string;
    budget?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    schema_version: string;
  };
  run?: {
    run_id: string;
    task_id: string;
    status: string;
    mode: RunMode;
    event_ids: string[];
    started_at?: string;
    completed_at?: string;
    checkpoint_id?: string;
  };
  flow?: {
    active_node_code: string;
    node_statuses: RunNodeStatus[];
  };
  delivery_report?: {
    worktree_path?: string;
    files_written: string[];
    artifacts_materialized: number;
  };
  links?: Record<string, unknown>;
  timeline: RunEvent[];
  agent_runs: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  gates: Record<string, unknown>[];
  /**
   * council 模式才有。
   *
   * ⚠️ `can_create_merge_authorization` 在当前后端**恒为 false** —— Council 由
   * proposer/reviewer/synthesis 几个 agent 角色自己裁决，**没有人类回写通道**。
   * 前端的裁决交互目前只改本地状态，见 ../transport.ts 里的扩展位说明。
   */
  council?: {
    enabled: true;
    status: RunStatus;
    decision_id?: string;
    verdict?: string;
    decision_mode?: string;
    selected_proposal_id?: string;
    selected_artifact_refs: string[];
    required_next_actions: string[];
    blocked_by: string[];
    can_create_merge_authorization: boolean;
    proposals?: Record<string, unknown>[];
    reviews?: Record<string, unknown>[];
    synthesis?: Record<string, unknown>;
    output?: Record<string, unknown>;
  };
  checkpoint?: Record<string, unknown>;
  errors: RunError[];
  final_output?: {
    status: 'completed' | 'failed' | 'cancelled';
    artifact_refs: string[];
    files_written: string[];
  };
}

/** 完整形态的快照（带 task/run/flow/delivery_report/links）。 */
export type FrontendWorkflowV01Snapshot = RunSnapshot &
  Required<Pick<RunSnapshot, 'task' | 'run' | 'flow' | 'delivery_report' | 'links'>> & {
    contract_version: 'frontend-workflow.v0.1';
  };

/** 瘦快照 → 完整快照的守卫（对齐后端 isFrontendWorkflowV01Snapshot）。 */
export function isFrontendWorkflowV01(
  snapshot: RunSnapshot,
): snapshot is FrontendWorkflowV01Snapshot {
  return snapshot.contract_version === 'frontend-workflow.v0.1';
}

// ── RPC 方法签名 ──

export interface RunCreateParams {
  prompt: string;
  mode?: RunMode;
  project_id?: string;
  client_task_id?: string;
  title?: string;
}

export interface RunCreateResult {
  run_id: string;
  task_id: string;
  status: 'running';
}

export interface PingResult {
  status: 'ok';
  protocol_version: string;
}

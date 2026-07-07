/**
 * 方向 A · Driver / ACP 接入契约。
 *
 * 数据形状同时对齐：
 *  - BCD `src/driver/contract.ts`（newide-scaffold）
 *  - 方向 A `src/driver/interface.ts`（acp-client-prototype，MockDriver 实现同款）
 * 两侧字段一致、同锚定 v0。前端只需数据形状，不含 `DriverRuntimeHandle` 的方法。
 */

import type {
  ArtifactRef,
  ContextPackRef,
  DriverId,
  DriverSessionId,
  RunId,
  SchemaVersion,
  TaskId,
  Timestamp,
} from './core';

/** Agent 认证策略（对齐方向 A `AuthStrategy`）。 */
export type AuthStrategy = 'none' | 'env-auto' | 'pre-configured' | 'interactive';

export interface DriverCapabilities {
  supports_acp_extension: boolean;
  supports_structured_output: boolean;
  supports_session_load: boolean;
  supports_tool_events: boolean;
  supports_permission_events: boolean;
}

export interface DriverPrompt {
  task_id: TaskId;
  run_id: RunId;
  prompt: string;
  context_pack_ref?: ContextPackRef;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface DriverToolEvent {
  tool_event_id: string;
  tool_name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  summary: string;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

export interface DriverError {
  code: string;
  message: string;
  retryable: boolean;
}

export type DriverRunStatus = 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface DriverRunResult {
  driver_run_result_id: string;
  session_id: DriverSessionId;
  status: DriverRunStatus;
  artifacts: ArtifactRef[];
  transcript_ref: ArtifactRef;
  tool_events: DriverToolEvent[];
  diagnostics: {
    driver_id: DriverId;
    duration_ms: number;
    notes: string[];
  };
  error?: DriverError;
  created_at: Timestamp;
  schema_version: SchemaVersion;
}

/**
 * Driver 运行时句柄 —— 方向 A 的运行时边界（此处仅保留数据 + 方法签名以供参考）。
 * 前端一般不直接持有，实际由 Coordinator/后端调用。
 */
export interface DriverRuntimeHandle {
  driver_id: DriverId;
  session_id: DriverSessionId;
  capabilities: DriverCapabilities;
  sendPrompt(input: DriverPrompt): Promise<DriverRunResult>;
  interrupt(reason: string): Promise<void>;
  collectTranscript(): Promise<ArtifactRef>;
}

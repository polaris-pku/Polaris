import type { RunEvent } from './rpc';

export type TaskRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunMode = 'single_agent' | 'council';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ContractError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface TaskRunSummary {
  run_id: string;
  task_id: string;
  status: TaskRunStatus;
  mode: RunMode;
  restartable: boolean;
  session_id?: string;
  started_at?: string;
  completed_at?: string;
  error?: ContractError;
}

export interface TaskSnapshot {
  contract_version: 'task-snapshot.v0';
  schema_version: string;
  revision: number;
  task: {
    task_id: string;
    parent_id?: string;
    status: string;
    owner_agent_id?: string;
    role_id?: string;
    risk_level: RiskLevel;
    spec: string;
    completion_criteria: string[];
    affected_paths: string[];
    budget?: {
      max_tokens?: number;
      max_wall_clock_seconds?: number;
      max_tool_calls?: number;
    };
    created_at: string;
    updated_at: string;
    schema_version: string;
  };
  current_run?: TaskRunSummary;
  run_history: TaskRunSummary[];
  market?: {
    winner_agent_id: string;
    winner_bid_id: string;
    ledger_ref: string;
    audit_ref: string;
    policy_version: string;
    seed: string;
  };
  council?: {
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    decision_id?: string;
    verdict?: 'select' | 'needs_human' | 'request_revision' | 'reject';
    result?: {
      quality: 'verified' | 'best_effort';
      final_artifact_ref: string;
      final_artifact_sha256: string;
      warnings: string[];
      unmet_criteria: string[];
      verification_refs: string[];
      decision_record_ref: string;
    };
  };
  waiting_reason?: string;
  warnings: string[];
  error?: ContractError;
  final_output?: {
    artifact_refs: string[];
    files_written: string[];
    changed_files: string[];
    response?: string;
    sha256?: string;
  };
}

export interface TaskCreateParams {
  spec: string;
  completion_criteria: string[];
  workspace_path: string;
  role_id?: string;
  parent_task_id?: string;
  deps?: string[];
  risk_level?: RiskLevel;
  affected_paths?: string[];
  budget?: {
    max_tokens?: number;
    max_wall_clock_seconds?: number;
    max_tool_calls?: number;
  };
  session_id?: string;
  mode?: RunMode;
  project_id?: string;
  client_task_id?: string;
  title?: string;
}

export interface TaskSubscribeResult {
  subscribed: true;
  snapshot: TaskSnapshot;
  replay_events: RunEvent[];
}

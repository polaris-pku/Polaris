import type { RunEvent } from './rpc';

export type RunCursor =
  | 'select_agent'
  | 'execute_agent'
  | 'council'
  | 'gate'
  | 'deliver'
  | 'mailbox_wait'
  | 'done';

/** Driver profiles may declare additional billing sources alongside proxy usage. */
export type RunUsageSource = string;

export interface RunUsageTokens {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_input_tokens: number;
  total_tokens: number;
  call_count: number;
}

export interface RunUsage {
  billed?: {
    metric: 'billed_tokens';
    by_source: Partial<Record<RunUsageSource, RunUsageTokens>>;
    pending_sources?: string[];
  };
  context?: {
    metric: 'context_tokens_used';
    context_tokens_used: number;
    complete: boolean;
    sessions: Array<{
      session_id: string;
      role_id?: string;
      context_tokens_used: number;
      context_window_size?: number;
      reported_cost?: { amount: number; currency: string };
    }>;
  };
  by_stage?: Record<
    string,
    {
      metric: 'proxy_billed_tokens';
      events: number;
      llm_calls: number;
      total_tokens: number;
      duration_ms?: number;
    }
  >;
}

export interface RunDriverActivity {
  state: 'turn_running' | 'tool_running' | 'disconnected';
  since: string;
  last_event_at: string;
  stale: boolean;
  tool_call_id?: string;
  tool_name?: string;
  tool_kind?: string;
  tool_title?: string;
}

export interface RunAgentActivity {
  role_id: string;
  state: 'thinking' | 'delegating';
  since: string;
  seq: number;
  stale: boolean;
  round?: number;
  tool_name?: string;
  driver?: RunDriverActivity;
}

export interface RunActivity {
  subject: 'agent';
  agents: RunAgentActivity[];
}

export type RunUsageScope = 'task' | 'system' | 'role' | 'run';

export type RunGetUsageParams = (
  | { scope: 'system'; scope_id?: string }
  | { scope: Exclude<RunUsageScope, 'system'>; scope_id: string }
) & { run_id?: string };

export interface RunUsageHistory {
  scope: RunUsageScope;
  scope_id?: string;
  as_of: string;
  runs_counted: number;
  runs_without_usage: number;
  complete: boolean;
  billed: {
    totals: RunUsageTokens;
    by_source: Partial<Record<RunUsageSource, RunUsageTokens>>;
  };
}

export interface RunGetUsageResult {
  usage?: RunUsage;
  history: RunUsageHistory;
}

export interface RunGetEventsParams {
  run_id: string;
  after_sequence?: number;
  limit?: number;
}

export interface RunGetEventsResult {
  events: RunEvent[];
  after_sequence: number;
  latest_sequence: number;
  has_more: boolean;
}

export interface RunGetPayloadResult {
  payload_ref: string;
  event: Record<string, unknown>;
}

export const PAYLOAD_REF_UNAVAILABLE_CODE = -32017;

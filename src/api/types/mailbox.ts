export type MailboxMessageType =
  | 'ask_help'
  | 'review_request'
  | 'proposal'
  | 'critique'
  | 'handoff'
  | 'status_update'
  | 'decision_request'
  | 'decision_response'
  | 'task.assigned'
  | 'driver.requested'
  | 'driver.completed';

export type MailboxMessageKind = 'request' | 'notice';

export interface MailboxMessage {
  message_id: string;
  task_id: string;
  workspace_path: string;
  thread_id: string;
  from_role_id: string;
  kind?: MailboxMessageKind;
  content?: string;
  type: MailboxMessageType;
  payload: Record<string, unknown>;
  artifact_refs: string[];
  requires_ack: boolean;
  reply_to_message_id?: string;
  idempotency_key: string;
  created_at: string;
  schema_version: string;
}

export interface MailboxDelivery {
  delivery_id: string;
  message_id: string;
  task_id: string;
  workspace_path: string;
  recipient_role_id: string;
  recipient_session_id?: string;
  status: 'pending' | 'injected' | 'acknowledged' | 'failed';
  deadline_at?: string;
  injected_at?: string;
  acknowledged_at?: string;
  retry_count: number;
  last_error?: { code: string; message: string; details?: Record<string, unknown> };
  last_delivery_event_id?: string;
  replay_cursor?: string;
  created_at: string;
  updated_at: string;
  schema_version: string;
}

export interface MailboxEnvelope {
  message: MailboxMessage;
  delivery: MailboxDelivery;
}

export interface MailboxSendParams {
  task_id: string;
  workspace_path: string;
  thread_id: string;
  from_role_id: string;
  to_role_id: string;
  type: MailboxMessageType;
  payload: Record<string, unknown>;
  requires_ack: boolean;
  idempotency_key: string;
  artifact_refs?: string[];
  deadline_seconds?: number;
}

export interface MailboxInboxParams {
  task_id: string;
  workspace_path: string;
  role_id: string;
  after_delivery_id?: string;
}

export interface MailboxAckParams {
  delivery_id: string;
  role_id: string;
}

export interface MailboxReplyParams {
  source_delivery_id: string;
  from_role_id: string;
  type: MailboxMessageType;
  payload: Record<string, unknown>;
  requires_ack: boolean;
  idempotency_key: string;
  artifact_refs?: string[];
  deadline_seconds?: number;
}

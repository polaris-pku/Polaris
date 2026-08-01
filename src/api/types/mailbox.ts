export type MailboxRecipient =
  | { agent_id: string; role_id?: never }
  | { role_id: string; agent_id?: never };

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

export interface MailboxMessage {
  message_id: string;
  thread_id: string;
  from_agent_id: string;
  type: MailboxMessageType;
  payload: Record<string, unknown>;
  artifact_refs: string[];
  requires_ack: boolean;
  reply_to_message_id?: string;
  created_at: string;
  schema_version: string;
}

export interface MailboxDelivery {
  delivery_id: string;
  message_id: string;
  recipient_agent_id?: string;
  recipient_role_id?: string;
  status: 'pending' | 'delivered' | 'acknowledged';
  deadline_at?: string;
  delivered_at?: string;
  acknowledged_at?: string;
  retry_count: number;
  last_error?: { code: string; message: string; details?: Record<string, unknown> };
  created_at: string;
  updated_at: string;
  schema_version: string;
}

export interface MailboxEnvelope {
  message: MailboxMessage;
  delivery: MailboxDelivery;
}

export interface MailboxSendParams {
  thread_id: string;
  from_agent_id: string;
  to: MailboxRecipient[];
  type: MailboxMessageType;
  payload: Record<string, unknown>;
  requires_ack: boolean;
  artifact_refs?: string[];
  deadline_seconds?: number;
}

export interface MailboxReplyParams extends Omit<MailboxSendParams, 'thread_id'> {
  source_delivery_id: string;
  source_recipient: MailboxRecipient;
}

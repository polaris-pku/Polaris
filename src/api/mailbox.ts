import { getTransport } from './transport';
import type {
  MailboxAckParams,
  MailboxInboxParams,
  MailboxReplyParams,
  MailboxSendParams,
} from './types/mailbox';

export const mailboxApi = {
  send: (params: MailboxSendParams) => getTransport().call('mailbox.send', params),
  inbox: (params: MailboxInboxParams) => getTransport().call('mailbox.inbox', params),
  acknowledge: (params: MailboxAckParams) => getTransport().call('mailbox.ack', params),
  reply: (params: MailboxReplyParams) => getTransport().call('mailbox.reply', params),
};

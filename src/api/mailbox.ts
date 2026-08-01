import { getTransport } from './transport';
import type { MailboxRecipient, MailboxReplyParams, MailboxSendParams } from './types/mailbox';

export const mailboxApi = {
  send: (params: MailboxSendParams) => getTransport().call('mailbox.send', params),
  inbox: (recipient: MailboxRecipient, afterDeliveryId?: string) =>
    getTransport().call('mailbox.inbox', {
      ...recipient,
      ...(afterDeliveryId ? { after_delivery_id: afterDeliveryId } : {}),
    }),
  acknowledge: (deliveryId: string, recipient: MailboxRecipient) =>
    getTransport().call('mailbox.ack', { delivery_id: deliveryId, ...recipient }),
  reply: (params: MailboxReplyParams) => getTransport().call('mailbox.reply', params),
};

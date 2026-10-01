import type { Conversation, Message } from './types'

/** Where one of my messages is on its way to the peer (see architecture.md, status derivation). */
export type DeliveryState = 'queued' | 'sending' | 'failed' | 'sent' | 'delivered' | 'read'

/**
 * Delivery state of one of my messages. Delivered and read come from the
 * peer's watermarks; pending messages show as queued while offline.
 */
export function deliveryState(
  m: Message,
  conversation: Pick<Conversation, 'peer_delivered_up_to_seq' | 'peer_read_up_to_seq'>,
  online: boolean,
): DeliveryState {
  switch (m.status) {
    case 'sending':
      return online ? 'sending' : 'queued'
    case 'failed':
      return 'failed'
    case 'sent':
      if (m.seq !== null && m.seq <= conversation.peer_read_up_to_seq) return 'read'
      if (m.seq !== null && m.seq <= conversation.peer_delivered_up_to_seq) return 'delivered'
      return 'sent'
  }
}

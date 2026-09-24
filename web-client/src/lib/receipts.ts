import type { ChatSocket } from './socket'

type Kind = 'delivered' | 'read'

/**
 * Tells the server how far this user has received / read each conversation.
 * Only the highest seq matters (receipts are watermarks), so it keeps the
 * latest target per conversation, sends when online, and resends after a
 * reconnect in case the last send was lost. The server ignores anything that
 * doesn't move a watermark forward.
 */
export class Receipts {
  private readonly socket: ChatSocket
  private readonly target = { delivered: new Map<string, number>(), read: new Map<string, number>() }
  private readonly sent = { delivered: new Map<string, number>(), read: new Map<string, number>() }

  constructor(socket: ChatSocket) {
    this.socket = socket
  }

  markDelivered(conversationId: string, seq: number) {
    this.raise('delivered', conversationId, seq)
  }

  /** Reading implies delivery; the server advances both. */
  markRead(conversationId: string, seq: number) {
    this.raise('read', conversationId, seq)
  }

  onOnline() {
    this.sent.delivered.clear()
    this.sent.read.clear()
    this.flush()
  }

  private raise(kind: Kind, conversationId: string, seq: number) {
    if (seq <= (this.target[kind].get(conversationId) ?? 0)) return
    this.target[kind].set(conversationId, seq)
    this.flush()
  }

  private flush() {
    for (const kind of ['delivered', 'read'] as const) {
      for (const [conversationId, seq] of this.target[kind]) {
        if (seq <= (this.sent[kind].get(conversationId) ?? 0)) continue
        // Reads cover deliveries, so skip a delivered receipt that a read already covers.
        if (kind === 'delivered' && seq <= (this.target.read.get(conversationId) ?? 0)) continue
        const ok = this.socket.send({ type: `receipt.${kind}`, conversation_id: conversationId, seq })
        if (!ok) return // offline; onOnline resends
        this.sent[kind].set(conversationId, seq)
      }
    }
  }
}

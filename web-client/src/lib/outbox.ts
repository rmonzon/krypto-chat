import type { ChatDb } from './db'
import type { ChatSocket } from './socket'
import type { Message, ServerEvent } from './types'

// Rejections that no retry can fix.
const PERMANENT_ERRORS = new Set(['invalid_message', 'not_a_member', 'duplicate_client_msg_id'])
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 5_000

type Ack = Extract<ServerEvent, { type: 'message.ack' }>
type ErrorEvent = Extract<ServerEvent, { type: 'error' }>

/**
 * Sends the user's pending messages (status 'sending' in the local DB), in
 * the order they were written, whenever the socket is online. Messages
 * survive reloads and offline periods; resending is safe because the
 * server dedupes on client_msg_id.
 */
export class Outbox {
  private readonly db: ChatDb
  private readonly socket: ChatSocket
  private readonly userId: string
  // Sent on the current connection and awaiting an ack or error.
  private readonly inFlight = new Set<string>()
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  constructor(db: ChatDb, socket: ChatSocket, userId: string) {
    this.db = db
    this.socket = socket
    this.userId = userId
  }

  async enqueue(message: Message) {
    await this.db.messages.put(message)
    void this.flush()
  }

  async retry(clientMsgId: string) {
    await this.db.messages.update([this.userId, clientMsgId], { status: 'sending', attempts: 0 })
    void this.flush()
  }

  /** Call when the socket (re)connects: anything unacked must be resent. */
  onOnline() {
    this.inFlight.clear()
    void this.flush()
  }

  async onAck(ack: Ack) {
    this.inFlight.delete(ack.client_msg_id)
    await this.db.messages.update([this.userId, ack.client_msg_id], {
      seq: ack.seq,
      created_at: ack.created_at,
      status: 'sent',
    })
  }

  async onError(error: ErrorEvent) {
    if (!error.client_msg_id) return
    this.inFlight.delete(error.client_msg_id)
    const key: [string, string] = [this.userId, error.client_msg_id]

    if (PERMANENT_ERRORS.has(error.reason)) {
      await this.db.messages.update(key, { status: 'failed' })
      return
    }

    const message = await this.db.messages.get(key)
    if (!message) return
    const attempts = (message.attempts ?? 0) + 1
    await this.db.messages.update(key, {
      attempts,
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'sending',
    })
    if (attempts < MAX_ATTEMPTS) this.scheduleRetry()
  }

  async flush() {
    if (this.socket.status !== 'online') return
    const pending = await this.db.messages
      .where('status')
      .equals('sending')
      .filter((m) => m.sender_id === this.userId)
      .toArray()
    pending.sort((a, b) => a.created_at.localeCompare(b.created_at))

    // No awaits in this loop, so concurrent flushes can't send a message twice.
    for (const m of pending) {
      if (this.inFlight.has(m.client_msg_id)) continue
      const sent = this.socket.send({
        type: 'message.send',
        client_msg_id: m.client_msg_id,
        conversation_id: m.conversation_id,
        content_type: m.content_type,
        body: m.body,
      })
      if (!sent) return // went offline; onOnline will pick up from here
      this.inFlight.add(m.client_msg_id)
    }
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.flush(), RETRY_DELAY_MS)
  }
}

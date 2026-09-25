import { liveQuery } from 'dexie'
import type { ChatDb } from './db'
import type { ChatSocket } from './socket'
import type { Message, ServerEvent } from './types'

// Rejections that no retry can fix.
const PERMANENT_ERRORS = new Set(['invalid_message', 'not_a_member', 'duplicate_client_msg_id'])
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 5_000
// No ack this long after sending, while "online", means the connection is
// probably dead without the browser noticing yet.
const ACK_TIMEOUT_MS = 15_000
const STALL_CHECK_MS = 5_000

type Ack = Extract<ServerEvent, { type: 'message.ack' }>
type ErrorEvent = Extract<ServerEvent, { type: 'error' }>
type Locks = Pick<LockManager, 'request'>

export type OutboxOptions = {
  /** Web Locks, to elect one sending tab per user. null: this tab always sends. */
  locks?: Locks | null
  now?: () => number
}

const defaultLocks = (): Locks | null =>
  typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null

/**
 * Sends the user's pending messages (status 'sending' in the local DB), in
 * the order they were written, whenever the socket is online. Messages
 * survive reloads and offline periods; resending is safe because the
 * server dedupes on client_msg_id.
 *
 * With several tabs open, only the tab holding the outbox lock sends. It
 * watches the shared DB, so messages written in other tabs go out too, and
 * another tab takes over when it closes.
 */
export class Outbox {
  private readonly db: ChatDb
  private readonly socket: ChatSocket
  private readonly userId: string
  private readonly locks: Locks | null
  private readonly now: () => number
  // Sent on the current connection and awaiting an ack or error → when sent.
  private readonly inFlight = new Map<string, number>()
  private started = false
  private leader = false
  private stopLeading: (() => void) | undefined
  private pendingWatch: { unsubscribe(): void } | undefined
  private stallTimer: ReturnType<typeof setInterval> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined

  constructor(db: ChatDb, socket: ChatSocket, userId: string, options: OutboxOptions = {}) {
    this.db = db
    this.socket = socket
    this.userId = userId
    this.locks = options.locks === undefined ? defaultLocks() : options.locks
    this.now = options.now ?? Date.now
  }

  start() {
    if (this.started) return
    this.started = true
    if (!this.locks) return this.becomeLeader()

    const abort = new AbortController()
    let release: (() => void) | undefined
    this.stopLeading = () => {
      abort.abort()
      release?.()
    }
    this.locks
      .request(`krypto-chat-outbox:${this.userId}`, { signal: abort.signal }, () => {
        // Hold the lock until stop() (or the tab closes).
        return new Promise<void>((resolve) => {
          release = resolve
          if (this.started) this.becomeLeader()
          else resolve()
        })
      })
      .catch(() => {}) // aborted while waiting for the lock
  }

  stop() {
    this.started = false
    this.leader = false
    this.stopLeading?.()
    this.stopLeading = undefined
    this.pendingWatch?.unsubscribe()
    this.pendingWatch = undefined
    clearInterval(this.stallTimer)
    clearTimeout(this.retryTimer)
    this.inFlight.clear()
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
    if (!this.leader || this.socket.status !== 'online') return
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
      this.inFlight.set(m.client_msg_id, this.now())
    }
  }

  /** Reconnects if any sent message has gone unacked for too long. */
  checkStalled() {
    if (this.socket.status !== 'online') return
    const cutoff = this.now() - ACK_TIMEOUT_MS
    for (const sentAt of this.inFlight.values()) {
      if (sentAt < cutoff) {
        this.socket.reconnect() // onOnline then resends everything unacked
        return
      }
    }
  }

  private becomeLeader() {
    this.leader = true
    // Fires now and whenever any tab adds or changes a pending message.
    this.pendingWatch = liveQuery(() =>
      this.db.messages.where('status').equals('sending').primaryKeys(),
    ).subscribe({ next: () => void this.flush(), error: () => {} })
    this.stallTimer = setInterval(() => this.checkStalled(), STALL_CHECK_MS)
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.flush(), RETRY_DELAY_MS)
  }
}

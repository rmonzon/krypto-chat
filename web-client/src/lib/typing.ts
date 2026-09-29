import type { ChatSocket } from './socket'

/** While a draft keeps changing, "typing" is re-sent at most this often. */
export const TYPING_RESEND_MS = 3_000
/** A peer's indicator disappears if no refresh arrives in this long (e.g. a lost "stop"). */
export const TYPING_EXPIRE_MS = 6_000

/** Tells peers when this user is typing: throttled starts, and a stop when the draft empties or is sent. */
export class TypingSender {
  private readonly socket: Pick<ChatSocket, 'send'>
  private readonly now: () => number
  // conversation id → when "typing" was last sent
  private readonly active = new Map<string, number>()

  constructor(socket: Pick<ChatSocket, 'send'>, now = () => Date.now()) {
    this.socket = socket
    this.now = now
  }

  draftChanged(conversationId: string, draft: string) {
    if (!draft.trim()) return this.stop(conversationId)
    const last = this.active.get(conversationId)
    const now = this.now()
    if (last !== undefined && now - last < TYPING_RESEND_MS) return
    if (this.socket.send({ type: 'typing', conversation_id: conversationId, typing: true })) {
      this.active.set(conversationId, now)
    }
  }

  /** After sending, clearing the draft, or leaving the conversation. */
  stop(conversationId: string) {
    if (!this.active.delete(conversationId)) return
    this.socket.send({ type: 'typing', conversation_id: conversationId, typing: false })
  }

  /** On reconnect: forget what was sent, so the next keystroke announces typing again. */
  reset() {
    this.active.clear()
  }
}

/** Which conversations have a peer typing right now. */
export class TypingTracker {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly listeners = new Set<(typing: ReadonlySet<string>) => void>()

  update(conversationId: string, typing: boolean) {
    const wasTyping = this.timers.has(conversationId)
    clearTimeout(this.timers.get(conversationId))
    this.timers.delete(conversationId)
    if (typing) {
      this.timers.set(
        conversationId,
        setTimeout(() => this.update(conversationId, false), TYPING_EXPIRE_MS),
      )
    }
    if (typing !== wasTyping) this.emit()
  }

  /** On disconnect: stops can't arrive anymore, so drop every indicator. */
  clearAll() {
    if (this.timers.size === 0) return
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.emit()
  }

  current(): ReadonlySet<string> {
    return new Set(this.timers.keys())
  }

  subscribe(listener: (typing: ReadonlySet<string>) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit() {
    const typing = this.current()
    for (const listener of this.listeners) listener(typing)
  }
}

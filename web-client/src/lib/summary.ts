import { compareMessages } from './db'
import type { Conversation, Message } from './types'

export type ConversationSummary = {
  /** Latest locally stored message, for the preview line. */
  latest?: Message
  /** Peer messages after my read watermark that are stored locally (deleted ones don't count). */
  unread: number
  /**
   * True when some messages after my read watermark aren't stored locally
   * yet (older history not loaded), so `unread` is only a lower bound.
   */
  unreadIsLowerBound: boolean
}

/** Per-conversation preview and unread count, from the locally stored messages. */
export function summarizeConversations(
  conversations: Conversation[],
  messages: Iterable<Message>,
  myId: string,
): Map<string, ConversationSummary> {
  const myRead = new Map(conversations.map((c) => [c.id, c.my_read_up_to_seq]))
  const summaries = new Map<string, ConversationSummary & { minSeq: number }>()

  for (const m of messages) {
    let s = summaries.get(m.conversation_id)
    if (!s) {
      s = { unread: 0, unreadIsLowerBound: false, minSeq: Infinity }
      summaries.set(m.conversation_id, s)
    }
    if (!s.latest || compareMessages(s.latest, m) < 0) s.latest = m
    if (m.seq === null) continue
    s.minSeq = Math.min(s.minSeq, m.seq)
    // undefined: cached by an older version that didn't store it; unknown until the next fetch.
    const read = myRead.get(m.conversation_id)
    if (read !== undefined && m.sender_id !== myId && m.seq > read && !m.deleted_at) s.unread++
  }

  const result = new Map<string, ConversationSummary>()
  for (const [id, { minSeq, ...s }] of summaries) {
    const read = myRead.get(id)
    result.set(id, {
      ...s,
      unreadIsLowerBound: s.unread > 0 && read !== undefined && minSeq > read + 1,
    })
  }
  return result
}

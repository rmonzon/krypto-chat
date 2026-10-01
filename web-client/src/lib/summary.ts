import Dexie from 'dexie'
import { compareMessages, msgKey, type ChatDb } from './db'
import { isExpired, ttlNotice } from './expiry'
import type { Conversation, Message } from './types'

type ConversationSummary = {
  /** Latest locally stored message that hasn't expired, for the preview line. */
  latest?: Message
  /**
   * Peer messages after my read watermark that are stored locally. Deleted
   * and expired messages and auto-delete notices don't count.
   */
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
  now = Date.now(),
): Map<string, ConversationSummary> {
  const myRead = new Map(conversations.map((c) => [c.id, c.my_read_up_to_seq]))
  const summaries = new Map<string, ConversationSummary & { minSeq: number }>()

  for (const m of messages) {
    let s = summaries.get(m.conversation_id)
    if (!s) {
      s = { unread: 0, unreadIsLowerBound: false, minSeq: Infinity }
      summaries.set(m.conversation_id, s)
    }
    const expired = isExpired(m, now)
    if (!expired && (!s.latest || compareMessages(s.latest, m) < 0)) s.latest = m
    if (m.seq === null) continue
    s.minSeq = Math.min(s.minSeq, m.seq)
    if (expired || ttlNotice(m) !== undefined) continue
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

/**
 * summarizeConversations for every stored conversation, reading only the
 * messages it needs through indexes rather than the whole table: per
 * conversation the oldest stored message, the latest one that hasn't
 * expired, and those after my read watermark, plus pending messages (which
 * have no seq yet). The list re-runs this on every change, so it shouldn't
 * grow with history.
 */
export async function loadSummaries(
  db: ChatDb,
  myId: string,
  now = Date.now(),
): Promise<Map<string, ConversationSummary>> {
  const conversations = await db.conversations.toArray()
  const bySeq = (id: string, from: unknown = Dexie.minKey) =>
    db.messages.where('[conversation_id+seq]').between([id, from], [id, Dexie.maxKey])
  const pending = await db.messages.where('status').anyOf('sending', 'failed').toArray()
  const perConversation = await Promise.all(
    conversations.map(async (c) => {
      const oldest = await bySeq(c.id).first()
      const latest = await bySeq(c.id)
        .reverse()
        .filter((m) => !isExpired(m, now))
        .first()
      // undefined: cached by an older version; unread isn't counted then anyway.
      const read = c.my_read_up_to_seq
      const unread = read === undefined ? [] : await bySeq(c.id, read + 1).toArray()
      return [oldest, latest, ...unread]
    }),
  )

  const messages = new Map<string, Message>()
  for (const m of [...pending, ...perConversation.flat()]) if (m) messages.set(msgKey(m), m)
  return summarizeConversations(conversations, messages.values(), myId, now)
}

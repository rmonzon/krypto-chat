import Dexie, { type EntityTable, type Table } from 'dexie'
import type { Conversation, Message, Profile, ServerMessage } from './types'

export type ChatDb = Dexie & {
  // Keyed by [sender_id, client_msg_id]: client_msg_id is only unique per sender.
  messages: Table<Message, [string, string]>
  conversations: EntityTable<Conversation, 'id'>
  meta: EntityTable<{ key: 'profile'; value: Profile }, 'key'>
  /** Per conversation: every message up to this seq is stored locally (see advanceCursor). */
  cursors: EntityTable<{ conversation_id: string; seq: number }, 'conversation_id'>
}

const dbs = new Map<string, ChatDb>()

/** One local database per user, so accounts on the same browser stay separate. */
export function getChatDb(userId: string): ChatDb {
  let db = dbs.get(userId)
  if (!db) {
    db = new Dexie(`krypto-chat-${userId}`) as ChatDb
    db.version(1).stores({
      messages: '[sender_id+client_msg_id], conversation_id, status',
      conversations: 'id',
      meta: 'key',
    })
    db.version(2).stores({ cursors: 'conversation_id' })
    dbs.set(userId, db)
  }
  return db
}

/** Deletes the user's local database (on sign-out). */
export async function deleteChatDb(userId: string) {
  const db = dbs.get(userId) ?? getChatDb(userId)
  dbs.delete(userId)
  await db.delete()
}

export function fromServer({ id: _id, ...m }: ServerMessage): Message {
  return { ...m, status: 'sent' }
}

/** Acked messages in seq order, then pending ones in the order they were written. */
export function compareMessages(a: Message, b: Message) {
  if (a.seq !== null && b.seq !== null) return a.seq - b.seq
  if (a.seq !== null) return -1
  if (b.seq !== null) return 1
  return a.created_at.localeCompare(b.created_at)
}

/** Most recently active first. */
export function compareConversations(a: Conversation, b: Conversation) {
  return (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at)
}

/**
 * Records that messages from..to (a gap-free seq range) are stored locally.
 * The cursor only moves when the range connects to it, so a live message
 * can't jump it past messages missed while offline. With no cursor yet, a
 * range starting at seq 1, or the conversation's latest page, starts one.
 */
export async function advanceCursor(
  db: ChatDb,
  conversationId: string,
  from: number,
  to: number,
  isLatestPage = false,
) {
  await db.transaction('rw', db.cursors, async () => {
    const current = (await db.cursors.get(conversationId))?.seq
    const connects = current === undefined ? from === 1 || isLatestPage : from <= current + 1
    if (connects && to > (current ?? 0)) await db.cursors.put({ conversation_id: conversationId, seq: to })
  })
}

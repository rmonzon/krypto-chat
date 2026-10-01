import Dexie, { type EntityTable, type Table } from 'dexie'
import type { Conversation, Message, Profile, ServerMessage } from './types'

export type ChatDb = Dexie & {
  // Keyed by [sender_id, client_msg_id]: client_msg_id is only unique per sender.
  messages: Table<Message, [string, string]>
  conversations: EntityTable<Conversation, 'id'>
  meta: EntityTable<{ key: 'profile'; value: Profile }, 'key'>
  /** Per conversation: every message up to this seq is stored locally (see advanceCursor). */
  cursors: EntityTable<{ conversation_id: string; seq: number }, 'conversation_id'>
  /** Per conversation: every edit/delete up to this change_seq is applied locally. */
  change_cursors: EntityTable<{ conversation_id: string; seq: number }, 'conversation_id'>
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
    db.version(3).stores({ change_cursors: 'conversation_id' })
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

/**
 * Stores messages from the server, skipping any whose local copy reflects a
 * later edit/delete (a page fetched before a live change must not undo it).
 * With onlyExisting, only updates messages already stored: used for changes,
 * which may be for older history that isn't loaded (and must not leave holes).
 */
export async function putServerMessages(
  db: ChatDb,
  incoming: ServerMessage[],
  { onlyExisting = false } = {},
) {
  if (!incoming.length) return
  await db.transaction('rw', db.messages, async () => {
    const local = await db.messages.bulkGet(incoming.map((m) => [m.sender_id, m.client_msg_id]))
    const newer = incoming.filter((m, i) => {
      const existing = local[i]
      if (!existing) return !onlyExisting
      return (m.change_seq ?? 0) >= (existing.change_seq ?? 0)
    })
    await db.messages.bulkPut(newer.map(fromServer))
  })
}

/** Moves the conversation's change cursor forward (never back). */
export async function advanceChangeCursor(db: ChatDb, conversationId: string, seq: number) {
  await db.transaction('rw', db.change_cursors, async () => {
    const current = (await db.change_cursors.get(conversationId))?.seq ?? 0
    if (seq > current) await db.change_cursors.put({ conversation_id: conversationId, seq })
  })
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
 * Stores conversations from the server without moving read/delivery
 * watermarks backwards: a snapshot fetched just before a receipt landed (or
 * before we marked something read locally) must not undo that progress.
 */
export async function putConversations(db: ChatDb, incoming: Conversation[]) {
  await db.transaction('rw', db.conversations, async () => {
    const existing = await db.conversations.bulkGet(incoming.map((c) => c.id))
    await db.conversations.bulkPut(
      incoming.map((c, i) => {
        const local = existing[i]
        if (!local) return c
        // ?? 0: conversations cached by older versions lack some watermarks.
        return {
          ...c,
          peer_delivered_up_to_seq: Math.max(
            c.peer_delivered_up_to_seq,
            local.peer_delivered_up_to_seq ?? 0,
          ),
          peer_read_up_to_seq: Math.max(c.peer_read_up_to_seq, local.peer_read_up_to_seq ?? 0),
          my_read_up_to_seq: Math.max(c.my_read_up_to_seq, local.my_read_up_to_seq ?? 0),
        }
      }),
    )
  })
}

/** Moves this user's read watermark forward (never back). */
export async function advanceMyRead(db: ChatDb, conversationId: string, seq: number) {
  await db.conversations
    .where('id')
    .equals(conversationId)
    .modify((c) => {
      c.my_read_up_to_seq = Math.max(c.my_read_up_to_seq ?? 0, seq)
    })
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

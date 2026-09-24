import Dexie, { type EntityTable, type Table } from 'dexie'
import type { Conversation, Message, Profile, ServerMessage } from './types'

export type ChatDb = Dexie & {
  // Keyed by [sender_id, client_msg_id]: client_msg_id is only unique per sender.
  messages: Table<Message, [string, string]>
  conversations: EntityTable<Conversation, 'id'>
  meta: EntityTable<{ key: 'profile'; value: Profile }, 'key'>
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
    dbs.set(userId, db)
  }
  return db
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

import { api } from './api'
import { advanceCursor, putServerMessages, type ChatDb } from './db'
import type { MessagePage, ServerMessage } from './types'

export const OLDER_PAGE_SIZE = 50

/**
 * Fetches a conversation's latest page of history and stores it. The page
 * covers everything up to up_to_seq (gaps expired), from its first message,
 * or from seq 1 if nothing older is left, so it can start or extend the
 * sync cursor. Returns the page's messages.
 */
export async function loadLatestMessages(
  db: ChatDb,
  conversationId: string,
): Promise<ServerMessage[]> {
  const { messages, has_more, up_to_seq } = await api<MessagePage>(
    `/conversations/${conversationId}/messages`,
  )
  await putServerMessages(db, messages)
  const from = has_more ? Math.min(...messages.map((m) => m.seq)) : 1
  await advanceCursor(db, conversationId, from, up_to_seq ?? 0, true)
  return messages
}

export type OlderPage = { count: number; hasMore: boolean }

/**
 * Fetches the page of messages just before beforeSeq and stores it locally.
 * Returns how many were fetched and whether there's anything older still.
 */
export async function loadOlderMessages(
  db: ChatDb,
  conversationId: string,
  beforeSeq: number,
): Promise<OlderPage> {
  const { messages, has_more } = await api<MessagePage>(
    `/conversations/${conversationId}/messages?before_seq=${beforeSeq}&limit=${OLDER_PAGE_SIZE}`,
  )
  await putServerMessages(db, messages)
  return { count: messages.length, hasMore: has_more }
}

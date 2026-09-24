import { api } from './api'
import { fromServer, type ChatDb } from './db'
import type { ServerMessage } from './types'

export const OLDER_PAGE_SIZE = 50

/**
 * Fetches the page of messages just before beforeSeq and stores it locally.
 * Returns how many were fetched (0 means there's nothing older).
 */
export async function loadOlderMessages(
  db: ChatDb,
  conversationId: string,
  beforeSeq: number,
): Promise<number> {
  const { messages } = await api<{ messages: ServerMessage[] }>(
    `/conversations/${conversationId}/messages?before_seq=${beforeSeq}&limit=${OLDER_PAGE_SIZE}`,
  )
  await db.messages.bulkPut(messages.map(fromServer))
  return messages.length
}

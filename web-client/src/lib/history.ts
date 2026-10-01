import { api } from './api'
import { putServerMessages, type ChatDb } from './db'
import type { MessagePage } from './types'

export const OLDER_PAGE_SIZE = 50

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

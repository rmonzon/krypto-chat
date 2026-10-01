import { api } from './api'
import { putServerMessages, type ChatDb } from './db'
import { isExpired, ttlNotice } from './expiry'
import type { Message, ServerMessage } from './types'

/** How long after sending a message its sender can edit or delete it (mirrors api-server). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000

/**
 * Whether I can still edit or delete this message: mine, acked, a regular
 * message (not a notice), not deleted or expired, within the window.
 */
export function canChange(m: Message, myId: string, now: number) {
  return (
    m.sender_id === myId &&
    m.status === 'sent' &&
    m.seq !== null &&
    !m.deleted_at &&
    ttlNotice(m) === undefined &&
    !isExpired(m, now) &&
    now - Date.parse(m.created_at) < EDIT_WINDOW_MS
  )
}

/** Edits (body) or deletes (null) a message on the server, then stores the result. */
export async function changeMessage(db: ChatDb, m: Message, body: string | null) {
  const path = `/conversations/${m.conversation_id}/messages/${m.seq}`
  const { message } = await api<{ message: ServerMessage }>(
    path,
    body === null ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify({ body }) },
  )
  await putServerMessages(db, [message])
}

import type { ChatDb } from './db'
import type { Message } from './types'

/** Auto-delete timers the server accepts, shortest first. */
export const TTL_OPTIONS: { seconds: number; label: string; short: string }[] = [
  { seconds: 300, label: '5 minutes', short: '5m' },
  { seconds: 3600, label: '1 hour', short: '1h' },
  { seconds: 86_400, label: '1 day', short: '1d' },
  { seconds: 604_800, label: '7 days', short: '7d' },
  { seconds: 2_592_000, label: '30 days', short: '30d' },
]

/** "1 hour", or a fallback for a timer this version doesn't know. */
export function ttlLabel(seconds: number, short = false) {
  const option = TTL_OPTIONS.find((o) => o.seconds === seconds)
  if (option) return short ? option.short : option.label
  return short ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 60)} minutes`
}

/** Content type of the notice the server posts when someone changes the timer. */
export const TTL_NOTICE_CONTENT_TYPE = 'application/vnd.krypto-chat.ttl+json'

/** The timer a notice announces (null: turned off), or undefined if m isn't a notice. */
export function ttlNotice(m: Message): number | null | undefined {
  if (m.content_type !== TTL_NOTICE_CONTENT_TYPE) return undefined
  try {
    const { ttl_seconds } = JSON.parse(m.body) as { ttl_seconds?: unknown }
    return typeof ttl_seconds === 'number' ? ttl_seconds : null
  } catch {
    return null
  }
}

/** "@alice set messages to disappear after 1 hour" (without the name). */
export function ttlNoticeText(ttlSeconds: number | null) {
  return ttlSeconds === null
    ? 'turned off auto-delete'
    : `set messages to disappear after ${ttlLabel(ttlSeconds)}`
}

export function isExpired(m: Message, now: number) {
  return !!m.expires_at && Date.parse(m.expires_at) <= now
}

/** Deletes the local copies of expired messages. Returns how many. */
export async function purgeExpired(db: ChatDb, now = Date.now()) {
  return db.messages.where('expires_at').belowOrEqual(new Date(now).toISOString()).delete()
}

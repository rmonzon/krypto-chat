import { describe, expect, it } from 'vitest'
import { conversation, freshDb, pendingMessage, serverMessage } from '../test/fakes'
import { fromServer } from './db'
import { canChange } from './edits'
import {
  isExpired,
  purgeExpired,
  TTL_NOTICE_CONTENT_TYPE,
  ttlLabel,
  ttlNotice,
  ttlNoticeText,
} from './expiry'
import { summarizeConversations } from './summary'

const now = Date.parse('2026-01-01T01:00:00Z')
const past = '2026-01-01T00:59:59.000Z'
const future = '2026-01-01T01:00:01.000Z'
const notice = (ttl: number | null, seq = 1) =>
  fromServer(
    serverMessage({
      seq,
      content_type: TTL_NOTICE_CONTENT_TYPE,
      body: JSON.stringify({ ttl_seconds: ttl }),
    }),
  )

describe('ttl notices', () => {
  it('reads the timer from notices, and ignores regular messages', () => {
    expect(ttlNotice(notice(3600))).toBe(3600)
    expect(ttlNotice(notice(null))).toBeNull()
    expect(ttlNotice(fromServer(serverMessage()))).toBeUndefined()
    expect(ttlNoticeText(3600)).toBe('set messages to disappear after 1 hour')
    expect(ttlNoticeText(null)).toBe('turned off auto-delete')
    expect(ttlLabel(604_800, true)).toBe('7d')
  })
})

describe('isExpired', () => {
  it('is true only once expires_at has passed', () => {
    expect(isExpired(fromServer(serverMessage({ expires_at: past })), now)).toBe(true)
    expect(isExpired(fromServer(serverMessage({ expires_at: future })), now)).toBe(false)
    expect(isExpired(fromServer(serverMessage()), now)).toBe(false)
  })
})

describe('purgeExpired', () => {
  it('deletes expired messages only', async () => {
    const db = freshDb()
    await db.messages.bulkPut([
      fromServer(serverMessage({ seq: 1, body: 'gone', expires_at: past })),
      fromServer(serverMessage({ seq: 2, body: 'soon', expires_at: future })),
      fromServer(serverMessage({ seq: 3, body: 'kept' })),
    ])

    expect(await purgeExpired(db, now)).toBe(1)
    const bodies = (await db.messages.toArray()).sort((a, b) => a.seq! - b.seq!).map((m) => m.body)
    expect(bodies).toEqual(['soon', 'kept'])
    expect(await purgeExpired(db, now)).toBe(0)
  })
})

describe('auto-delete in summaries and edits', () => {
  it('skips expired messages in the preview and unread count, and notices in unread', () => {
    const messages = [
      fromServer(serverMessage({ seq: 1, body: 'visible' })),
      notice(300, 2),
      fromServer(serverMessage({ seq: 3, body: '', expires_at: past })),
    ]
    const summary = summarizeConversations([conversation()], messages, 'me', now).get('conv-1')!
    expect(summary.latest?.content_type).toBe(TTL_NOTICE_CONTENT_TYPE)
    expect(summary.unread).toBe(1)
  })

  it('doesn’t offer edit/delete on notices or expired messages', () => {
    const mine = { sender_id: 'me', seq: 1, status: 'sent' as const, created_at: new Date(now).toISOString() }
    expect(canChange(pendingMessage(mine), 'me', now)).toBe(true)
    expect(canChange(pendingMessage({ ...mine, content_type: TTL_NOTICE_CONTENT_TYPE }), 'me', now)).toBe(false)
    expect(canChange(pendingMessage({ ...mine, expires_at: past }), 'me', now)).toBe(false)
  })
})

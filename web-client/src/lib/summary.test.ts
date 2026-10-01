import { describe, expect, it } from 'vitest'
import { fromServer } from './db'
import { TTL_NOTICE_CONTENT_TYPE } from './expiry'
import { loadSummaries, summarizeConversations } from './summary'
import { conversation, freshDb, pendingMessage, serverMessage } from '../test/fakes'
import type { Conversation } from './types'

const peerMsg = (seq: number) => fromServer(serverMessage({ seq, sender_id: 'peer' }))
const myMsg = (seq: number) => fromServer(serverMessage({ seq, sender_id: 'me' }))

describe('summarizeConversations', () => {
  it('counts peer messages after my read watermark, ignoring my own', () => {
    const summary = summarizeConversations(
      [conversation({ my_read_up_to_seq: 2 })],
      [peerMsg(1), peerMsg(2), myMsg(3), peerMsg(4), peerMsg(5)],
      'me',
    ).get('conv-1')

    expect(summary).toMatchObject({ unread: 2, unreadIsLowerBound: false })
    expect(summary?.latest?.seq).toBe(5)
  })

  it('treats a pending message of mine as the latest, and never as unread', () => {
    const pending = pendingMessage()
    const summary = summarizeConversations([conversation()], [peerMsg(1), pending], 'me').get(
      'conv-1',
    )

    expect(summary).toMatchObject({ unread: 1, latest: pending })
  })

  it('flags the count as a lower bound when unread history is not stored locally', () => {
    // Read up to 2, but only 10–11 are local (3–9 not loaded yet).
    const summaries = summarizeConversations(
      [conversation({ my_read_up_to_seq: 2 })],
      [peerMsg(10), peerMsg(11)],
      'me',
    )

    expect(summaries.get('conv-1')).toMatchObject({
      unread: 2,
      unreadIsLowerBound: true,
    })
  })

  it('shows no count when the read watermark is unknown', () => {
    const cachedByOlderVersion = {
      ...conversation(),
      my_read_up_to_seq: undefined,
    } as unknown as Conversation
    const summaries = summarizeConversations([cachedByOlderVersion], [peerMsg(1)], 'me')

    expect(summaries.get('conv-1')).toMatchObject({ unread: 0 })
  })
})

describe('loadSummaries', () => {
  it('matches summarizing every stored message', async () => {
    const db = freshDb()
    const now = Date.parse('2026-01-01T12:00:00Z')
    const expired = new Date(now - 1000).toISOString()
    const later = new Date(now + 60_000).toISOString()
    const msg = (conversation_id: string, seq: number, sender_id = 'peer', extra = {}) =>
      fromServer(serverMessage({ conversation_id, seq, sender_id, ...extra }))

    await db.conversations.bulkPut([
      conversation({ id: 'read-some', my_read_up_to_seq: 3 }),
      conversation({ id: 'gap', my_read_up_to_seq: 2 }),
      // Cached by an older version, without a read watermark.
      { ...conversation({ id: 'legacy' }), my_read_up_to_seq: undefined } as unknown as Conversation,
      conversation({ id: 'empty' }),
    ])
    await db.messages.bulkPut([
      msg('read-some', 1),
      msg('read-some', 2, 'me'),
      msg('read-some', 3),
      msg('read-some', 4, 'peer', { deleted_at: '2026-01-01T00:00:00Z' }),
      msg('read-some', 5, 'peer', { content_type: TTL_NOTICE_CONTENT_TYPE, body: '{}' }),
      msg('read-some', 6, 'peer', { expires_at: later }),
      msg('read-some', 7, 'peer', { expires_at: expired }),
      pendingMessage({ conversation_id: 'read-some', sender_id: 'me' }),
      pendingMessage({ conversation_id: 'gap', sender_id: 'me', status: 'failed' }),
      msg('gap', 10),
      msg('gap', 11, 'peer', { expires_at: expired }),
      msg('legacy', 1),
    ])

    const everything = summarizeConversations(
      await db.conversations.toArray(),
      await db.messages.toArray(),
      'me',
      now,
    )
    expect(await loadSummaries(db, 'me', now)).toEqual(everything)
    // The fixture exercises what it should.
    expect(everything.get('read-some')).toMatchObject({ unread: 1, unreadIsLowerBound: false })
    expect(everything.get('gap')).toMatchObject({ unread: 1, unreadIsLowerBound: true })
    expect(everything.get('read-some')?.latest?.status).toBe('sending')
  })

  it('takes the latest message that has not expired', async () => {
    const db = freshDb()
    const now = Date.parse('2026-01-01T12:00:00Z')
    await db.conversations.put(conversation({ my_read_up_to_seq: 3 }))
    await db.messages.bulkPut([
      fromServer(serverMessage({ seq: 1 })),
      fromServer(serverMessage({ seq: 2, expires_at: new Date(now - 1).toISOString() })),
    ])
    expect((await loadSummaries(db, 'me', now)).get('conv-1')?.latest?.seq).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { freshDb, pendingMessage, serverMessage } from '../test/fakes'
import {
  advanceCursor,
  compareConversations,
  compareMessages,
  deleteChatDb,
  fromServer,
  getChatDb,
} from './db'
import type { Conversation } from './types'

describe('advanceCursor', () => {
  it('only moves over ranges that connect to the cursor', async () => {
    const db = freshDb()
    const cursor = async () => (await db.cursors.get('a'))?.seq

    // No cursor: a live message that isn't seq 1 can't start one.
    await advanceCursor(db, 'a', 5, 5)
    expect(await cursor()).toBeUndefined()

    // Seq 1 starts it; contiguous messages extend it.
    await advanceCursor(db, 'a', 1, 1)
    await advanceCursor(db, 'a', 2, 2)
    expect(await cursor()).toBe(2)

    // A gap (3–4 missed while offline): a live 5 must not jump the cursor.
    await advanceCursor(db, 'a', 5, 5)
    expect(await cursor()).toBe(2)

    // A sync page filling 3..5 connects; older ranges never move it back.
    await advanceCursor(db, 'a', 3, 5)
    await advanceCursor(db, 'a', 1, 3)
    expect(await cursor()).toBe(5)
  })

  it('starts a cursor from the latest page, but never jumps an existing one with it', async () => {
    const db = freshDb()
    await advanceCursor(db, 'fresh', 951, 1000, true)
    expect((await db.cursors.get('fresh'))?.seq).toBe(1000)

    await advanceCursor(db, 'old', 1, 5)
    await advanceCursor(db, 'old', 40, 90, true)
    expect((await db.cursors.get('old'))?.seq).toBe(5)
  })
})

describe('compareMessages', () => {
  it('orders acked messages by seq, then pending ones by creation time', () => {
    const pendingLater = pendingMessage({ created_at: '2026-01-01T00:00:02.000Z' })
    const pendingEarlier = pendingMessage({ created_at: '2026-01-01T00:00:01.000Z' })
    const two = fromServer(serverMessage({ seq: 2, created_at: '2026-01-01T00:00:09.000Z' }))
    const one = fromServer(serverMessage({ seq: 1 }))
    const sorted = [pendingLater, two, pendingEarlier, one].sort(compareMessages)
    expect(sorted).toEqual([one, two, pendingEarlier, pendingLater])
  })
})

describe('compareConversations', () => {
  it('puts the most recently active first, falling back to creation time', () => {
    const base = { last_seq: 0, peer: { id: 'p', username: 'p', display_name: 'P' }, peer_delivered_up_to_seq: 0, peer_read_up_to_seq: 0 }
    const oldButActive: Conversation = { ...base, id: 'a', created_at: '2026-01-01T00:00:00Z', last_message_at: '2026-01-05T00:00:00Z' }
    const newQuiet: Conversation = { ...base, id: 'b', created_at: '2026-01-03T00:00:00Z', last_message_at: null }
    const oldQuiet: Conversation = { ...base, id: 'c', created_at: '2026-01-02T00:00:00Z', last_message_at: null }
    expect([oldQuiet, newQuiet, oldButActive].sort(compareConversations).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('fromServer', () => {
  it('drops the server id and marks the message sent', () => {
    const m = serverMessage({ seq: 3 })
    const local = fromServer(m)
    expect(local).not.toHaveProperty('id')
    expect(local).toMatchObject({ seq: 3, status: 'sent', client_msg_id: m.client_msg_id })
  })
})

describe('deleteChatDb', () => {
  it("removes the user's local data", async () => {
    const userId = `test-${crypto.randomUUID()}`
    await getChatDb(userId).messages.put(pendingMessage())
    await deleteChatDb(userId)
    expect(await getChatDb(userId).messages.count()).toBe(0)
  })
})

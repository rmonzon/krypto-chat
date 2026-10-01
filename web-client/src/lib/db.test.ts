import { describe, expect, it } from 'vitest'
import { conversation, freshDb, pendingMessage, serverMessage } from '../test/fakes'
import {
  advanceChangeCursor,
  advanceCursor,
  advanceMyRead,
  compareConversations,
  compareMessages,
  deleteChatDb,
  fromServer,
  getChatDb,
  putConversations,
  putServerMessages,
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

describe('putConversations', () => {
  it('stores new conversations as given', async () => {
    const db = freshDb()
    await putConversations(db, [conversation({ my_read_up_to_seq: 4 })])
    expect(await db.conversations.get('conv-1')).toEqual(conversation({ my_read_up_to_seq: 4 }))
  })

  it('takes fresh fields from the server but never moves watermarks backwards', async () => {
    const db = freshDb()
    await db.conversations.put(
      conversation({ my_read_up_to_seq: 7, peer_delivered_up_to_seq: 5, peer_read_up_to_seq: 1 }),
    )

    // A snapshot fetched before the local progress landed.
    await putConversations(db, [
      conversation({
        last_seq: 9,
        my_read_up_to_seq: 3,
        peer_delivered_up_to_seq: 2,
        peer_read_up_to_seq: 2,
      }),
    ])

    expect(await db.conversations.get('conv-1')).toMatchObject({
      last_seq: 9,
      my_read_up_to_seq: 7,
      peer_delivered_up_to_seq: 5,
      peer_read_up_to_seq: 2,
    })
  })
})

describe('advanceMyRead', () => {
  it('only moves the read watermark forward', async () => {
    const db = freshDb()
    await db.conversations.put(conversation({ my_read_up_to_seq: 3 }))

    await advanceMyRead(db, 'conv-1', 5)
    await advanceMyRead(db, 'conv-1', 4)

    expect((await db.conversations.get('conv-1'))?.my_read_up_to_seq).toBe(5)
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
    const base = { last_seq: 0, last_change_seq: 0, peer: { id: 'p', username: 'p', display_name: 'P' }, peer_delivered_up_to_seq: 0, peer_read_up_to_seq: 0, my_read_up_to_seq: 0 }
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

describe('putServerMessages', () => {
  it('never lets an older snapshot undo a newer edit or delete', async () => {
    const db = freshDb()
    const original = serverMessage({ seq: 1, body: 'helo' })
    const key: [string, string] = [original.sender_id, original.client_msg_id]
    const edited = { ...original, body: 'hello', edited_at: '2026-01-01T00:01:00Z', change_seq: 1 }
    const deleted = { ...original, body: '', deleted_at: '2026-01-01T00:02:00Z', change_seq: 2 }

    await putServerMessages(db, [deleted])
    await putServerMessages(db, [edited])
    await putServerMessages(db, [original])
    expect(await db.messages.get(key)).toMatchObject({ body: '', change_seq: 2 })
  })

  it('with onlyExisting, updates stored messages but adds nothing', async () => {
    const db = freshDb()
    const stored = serverMessage({ seq: 5, body: 'a' })
    await putServerMessages(db, [stored])

    await putServerMessages(
      db,
      [
        { ...stored, body: 'b', change_seq: 1 },
        serverMessage({ seq: 2, change_seq: 2 }), // older history that isn't loaded
      ],
      { onlyExisting: true },
    )
    expect((await db.messages.toArray()).map((m) => [m.seq, m.body])).toEqual([[5, 'b']])
  })
})

describe('advanceChangeCursor', () => {
  it('only moves forward', async () => {
    const db = freshDb()
    await advanceChangeCursor(db, 'a', 3)
    await advanceChangeCursor(db, 'a', 1)
    expect((await db.change_cursors.get('a'))?.seq).toBe(3)
  })
})

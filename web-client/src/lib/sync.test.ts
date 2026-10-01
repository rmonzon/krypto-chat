import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freshDb, serverMessage } from '../test/fakes'
import type { Receipts } from './receipts'
import type { Conversation, SyncResponse } from './types'

vi.mock('./api', () => ({ api: vi.fn() }))
const { api } = await import('./api')
const { Syncer } = await import('./sync')
const apiMock = vi.mocked(api)

const conversation: Conversation = {
  id: 'conv-1',
  last_seq: 3,
  last_change_seq: 0,
  message_ttl_seconds: null,
  created_at: '2026-01-01T00:00:00Z',
  last_message_at: '2026-01-01T00:05:00Z',
  peer: { id: 'peer', username: 'peer', display_name: 'Peer' },
  peer_delivered_up_to_seq: 1,
  peer_read_up_to_seq: 0,
  my_read_up_to_seq: 0,
}

function setup() {
  const db = freshDb()
  const receipts = { markDelivered: vi.fn() }
  const syncer = new Syncer(db, 'me', receipts as unknown as Receipts)
  return { db, receipts, syncer }
}

function respond(...responses: SyncResponse[]) {
  for (const response of responses) apiMock.mockResolvedValueOnce(response)
}

const sentCursors = (call: number) =>
  JSON.parse(apiMock.mock.calls[call]![1]!.body as string).cursors as Record<string, number>

beforeEach(() => apiMock.mockReset())

describe('Syncer', () => {
  it('stores conversations and messages, starts cursors, and marks peer messages delivered', async () => {
    const { db, receipts, syncer } = setup()
    respond({
      conversations: [conversation],
      messages: [
        serverMessage({ seq: 2, sender_id: 'peer' }),
        serverMessage({ seq: 3, sender_id: 'me' }),
      ],
      changes: [],
      synced_up_to: { 'conv-1': 3 },
      has_more: false,
    })

    await syncer.run()

    expect(sentCursors(0)).toEqual({})
    expect(await db.conversations.get('conv-1')).toEqual(conversation)
    expect(await db.messages.count()).toBe(2)
    // No cursor was sent, so the server returned the latest page: it starts the cursor.
    expect((await db.cursors.get('conv-1'))?.seq).toBe(3)
    expect(receipts.markDelivered).toHaveBeenCalledExactlyOnceWith('conv-1', 2)
  })

  it('pages with advanced cursors while has_more is set', async () => {
    const { db, syncer } = setup()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 10 })
    respond(
      {
        conversations: [conversation],
        messages: [serverMessage({ seq: 11 }), serverMessage({ seq: 12 })],
        changes: [],
        synced_up_to: { 'conv-1': 12 },
        has_more: true,
      },
      {
        conversations: [conversation],
        messages: [serverMessage({ seq: 13 })],
        changes: [],
        synced_up_to: { 'conv-1': 13 },
        has_more: false,
      },
    )

    await syncer.run()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(sentCursors(0)).toEqual({ 'conv-1': 10 })
    expect(sentCursors(1)).toEqual({ 'conv-1': 12 })
    expect((await db.cursors.get('conv-1'))?.seq).toBe(13)
  })

  it('sends change cursors, applies changes to stored messages only, and advances them', async () => {
    const { db, syncer } = setup()
    const stored = serverMessage({ seq: 3, body: 'helo' })
    await db.messages.put({ ...stored, status: 'sent' })
    await db.cursors.put({ conversation_id: 'conv-1', seq: 3 })
    await db.change_cursors.put({ conversation_id: 'conv-1', seq: 1 })
    const other = { ...conversation, id: 'conv-2', last_change_seq: 4 }
    respond({
      conversations: [{ ...conversation, last_change_seq: 3 }, other],
      messages: [],
      changes: [
        serverMessage({ seq: 1, change_seq: 2 }), // not loaded locally: skipped
        { ...stored, body: 'hello', edited_at: '2026-01-01T00:01:00Z', change_seq: 3 },
      ],
      synced_up_to: { 'conv-1': 3 },
      has_more: false,
    })

    await syncer.run()

    const body = JSON.parse(apiMock.mock.calls[0]![1]!.body as string)
    expect(body.change_cursors).toEqual({ 'conv-1': 1 })
    expect((await db.messages.toArray()).map((m) => [m.seq, m.body])).toEqual([[3, 'hello']])
    expect((await db.change_cursors.get('conv-1'))?.seq).toBe(3)
    // No changes sent for it: already current as of the snapshot.
    expect((await db.change_cursors.get('conv-2'))?.seq).toBe(4)
  })

  it('moves cursors over expired gaps to where the server says it synced up to', async () => {
    const { db, syncer } = setup()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 10 })
    const allExpired = { ...conversation, id: 'conv-2', last_seq: 7 }
    // 11-19 expired while offline; conv-2 has no cursor and nothing left.
    respond({
      conversations: [conversation, allExpired],
      messages: [serverMessage({ seq: 20 })],
      changes: [],
      synced_up_to: { 'conv-1': 20, 'conv-2': 7 },
      has_more: false,
    })

    await syncer.run()

    expect((await db.cursors.get('conv-1'))?.seq).toBe(20)
    expect((await db.cursors.get('conv-2'))?.seq).toBe(7)
  })

  it('collapses overlapping runs into one follow-up sync', async () => {
    const { syncer } = setup()
    apiMock.mockResolvedValue({ conversations: [], messages: [], changes: [], synced_up_to: {}, has_more: false })

    await Promise.all([syncer.run(), syncer.run(), syncer.run()])

    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('swallows network errors so the next reconnect can retry', async () => {
    const { syncer } = setup()
    apiMock.mockRejectedValueOnce(new Error('offline'))
    await expect(syncer.run()).resolves.toBeUndefined()

    respond({ conversations: [], messages: [], changes: [], synced_up_to: {}, has_more: false })
    await syncer.run()
    expect(apiMock).toHaveBeenCalledTimes(2)
  })
})

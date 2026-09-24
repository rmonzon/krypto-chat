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
  created_at: '2026-01-01T00:00:00Z',
  last_message_at: '2026-01-01T00:05:00Z',
  peer: { id: 'peer', username: 'peer', display_name: 'Peer' },
  peer_delivered_up_to_seq: 1,
  peer_read_up_to_seq: 0,
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
        has_more: true,
      },
      { conversations: [conversation], messages: [serverMessage({ seq: 13 })], has_more: false },
    )

    await syncer.run()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(sentCursors(0)).toEqual({ 'conv-1': 10 })
    expect(sentCursors(1)).toEqual({ 'conv-1': 12 })
    expect((await db.cursors.get('conv-1'))?.seq).toBe(13)
  })

  it('collapses overlapping runs into one follow-up sync', async () => {
    const { syncer } = setup()
    apiMock.mockResolvedValue({ conversations: [], messages: [], has_more: false })

    await Promise.all([syncer.run(), syncer.run(), syncer.run()])

    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('swallows network errors so the next reconnect can retry', async () => {
    const { syncer } = setup()
    apiMock.mockRejectedValueOnce(new Error('offline'))
    await expect(syncer.run()).resolves.toBeUndefined()

    respond({ conversations: [], messages: [], has_more: false })
    await syncer.run()
    expect(apiMock).toHaveBeenCalledTimes(2)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freshDb, serverMessage } from '../test/fakes'

vi.mock('./api', () => ({ api: vi.fn() }))
const { api } = await import('./api')
const { loadLatestMessages, loadOlderMessages, OLDER_PAGE_SIZE } = await import('./history')
const apiMock = vi.mocked(api)

beforeEach(() => apiMock.mockReset())

describe('loadOlderMessages', () => {
  it('requests the page before the given seq and stores it as sent', async () => {
    const db = freshDb()
    apiMock.mockResolvedValueOnce({
      messages: [serverMessage({ seq: 48 }), serverMessage({ seq: 49 })],
      has_more: true,
    })

    const page = await loadOlderMessages(db, 'conv-1', 50)

    expect(apiMock).toHaveBeenCalledExactlyOnceWith(
      `/conversations/conv-1/messages?before_seq=50&limit=${OLDER_PAGE_SIZE}`,
    )
    expect(page).toEqual({ count: 2, hasMore: true })
    const stored = await db.messages.where('conversation_id').equals('conv-1').toArray()
    expect(stored.map((m) => [m.seq, m.status]).sort()).toEqual([
      [48, 'sent'],
      [49, 'sent'],
    ])
  })

  it('does not touch the sync cursor (older pages sit below it)', async () => {
    const db = freshDb()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 90 })
    apiMock.mockResolvedValueOnce({ messages: [serverMessage({ seq: 1 })], has_more: false })

    await loadOlderMessages(db, 'conv-1', 41)

    expect((await db.cursors.get('conv-1'))?.seq).toBe(90)
  })

  it('reports when the server has nothing older (the rest may have expired)', async () => {
    apiMock.mockResolvedValueOnce({ messages: [], has_more: false })
    expect(await loadOlderMessages(freshDb(), 'conv-1', 40)).toEqual({ count: 0, hasMore: false })
  })
})

describe('loadLatestMessages', () => {
  const cursor = async (db: ReturnType<typeof freshDb>) => (await db.cursors.get('conv-1'))?.seq

  it('requests the latest page, stores it, and returns its messages', async () => {
    const db = freshDb()
    const messages = [serverMessage({ seq: 1 }), serverMessage({ seq: 2 })]
    apiMock.mockResolvedValueOnce({ messages, has_more: false, up_to_seq: 2 })

    expect(await loadLatestMessages(db, 'conv-1')).toEqual(messages)
    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/conversations/conv-1/messages')
    expect(await db.messages.count()).toBe(2)
  })

  it('with nothing older left, covers seq 1 to up_to_seq, gaps included', async () => {
    const db = freshDb()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 2 })
    // Seqs 3-5 and 8 expired; the server says the page covers up to 8.
    apiMock.mockResolvedValueOnce({
      messages: [serverMessage({ seq: 6 }), serverMessage({ seq: 7 })],
      has_more: false,
      up_to_seq: 8,
    })

    await loadLatestMessages(db, 'conv-1')

    expect(await cursor(db)).toBe(8)
  })

  it('with older history left, starts a cursor but never jumps an existing one', async () => {
    const page = {
      messages: [serverMessage({ seq: 40 }), serverMessage({ seq: 41 })],
      has_more: true,
      up_to_seq: 41,
    }

    const fresh = freshDb()
    apiMock.mockResolvedValueOnce(page)
    await loadLatestMessages(fresh, 'conv-1')
    expect(await cursor(fresh)).toBe(41)

    // Seqs 11-39 may be missing locally, so a cursor at 10 must stay put.
    const behind = freshDb()
    await behind.cursors.put({ conversation_id: 'conv-1', seq: 10 })
    apiMock.mockResolvedValueOnce(page)
    await loadLatestMessages(behind, 'conv-1')
    expect(await cursor(behind)).toBe(10)
  })

  it('starts no cursor for an empty conversation', async () => {
    const db = freshDb()
    apiMock.mockResolvedValueOnce({ messages: [], has_more: false, up_to_seq: 0 })
    expect(await loadLatestMessages(db, 'conv-1')).toEqual([])
    expect(await cursor(db)).toBeUndefined()
  })
})

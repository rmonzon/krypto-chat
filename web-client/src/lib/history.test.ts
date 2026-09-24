import { beforeEach, describe, expect, it, vi } from 'vitest'
import { freshDb, serverMessage } from '../test/fakes'

vi.mock('./api', () => ({ api: vi.fn() }))
const { api } = await import('./api')
const { loadOlderMessages, OLDER_PAGE_SIZE } = await import('./history')
const apiMock = vi.mocked(api)

beforeEach(() => apiMock.mockReset())

describe('loadOlderMessages', () => {
  it('requests the page before the given seq and stores it as sent', async () => {
    const db = freshDb()
    apiMock.mockResolvedValueOnce({
      messages: [serverMessage({ seq: 48 }), serverMessage({ seq: 49 })],
    })

    const count = await loadOlderMessages(db, 'conv-1', 50)

    expect(apiMock).toHaveBeenCalledExactlyOnceWith(
      `/conversations/conv-1/messages?before_seq=50&limit=${OLDER_PAGE_SIZE}`,
    )
    expect(count).toBe(2)
    const stored = await db.messages.where('conversation_id').equals('conv-1').toArray()
    expect(stored.map((m) => [m.seq, m.status]).sort()).toEqual([
      [48, 'sent'],
      [49, 'sent'],
    ])
  })

  it('does not touch the sync cursor (older pages sit below it)', async () => {
    const db = freshDb()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 90 })
    apiMock.mockResolvedValueOnce({ messages: [serverMessage({ seq: 1 })] })

    await loadOlderMessages(db, 'conv-1', 41)

    expect((await db.cursors.get('conv-1'))?.seq).toBe(90)
  })

  it('returns 0 when there is nothing older', async () => {
    apiMock.mockResolvedValueOnce({ messages: [] })
    expect(await loadOlderMessages(freshDb(), 'conv-1', 1)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { fakeSocket } from '../test/fakes'
import { Receipts } from './receipts'

describe('Receipts', () => {
  it('sends only receipts that raise the watermark', () => {
    const socket = fakeSocket()
    const receipts = new Receipts(socket)
    receipts.markDelivered('c', 3)
    receipts.markDelivered('c', 3)
    receipts.markDelivered('c', 2)
    receipts.markDelivered('c', 5)
    expect(socket.sent).toEqual([
      { type: 'receipt.delivered', conversation_id: 'c', seq: 3 },
      { type: 'receipt.delivered', conversation_id: 'c', seq: 5 },
    ])
  })

  it('skips delivered receipts already covered by a read', () => {
    const socket = fakeSocket()
    const receipts = new Receipts(socket)
    receipts.markRead('c', 4)
    receipts.markDelivered('c', 4)
    receipts.markDelivered('c', 6)
    expect(socket.sent).toEqual([
      { type: 'receipt.read', conversation_id: 'c', seq: 4 },
      { type: 'receipt.delivered', conversation_id: 'c', seq: 6 },
    ])
  })

  it('holds receipts while offline and sends only the latest on reconnect', () => {
    const socket = fakeSocket('offline')
    const receipts = new Receipts(socket)
    receipts.markDelivered('a', 1)
    receipts.markDelivered('a', 2)
    receipts.markRead('b', 7)
    expect(socket.sent).toEqual([])

    socket.status = 'online'
    receipts.onOnline()
    expect(socket.sent).toEqual([
      { type: 'receipt.delivered', conversation_id: 'a', seq: 2 },
      { type: 'receipt.read', conversation_id: 'b', seq: 7 },
    ])
  })

  it('resends current watermarks after a reconnect in case they were lost', () => {
    const socket = fakeSocket()
    const receipts = new Receipts(socket)
    receipts.markDelivered('a', 2)
    receipts.onOnline()
    expect(socket.sent).toEqual([
      { type: 'receipt.delivered', conversation_id: 'a', seq: 2 },
      { type: 'receipt.delivered', conversation_id: 'a', seq: 2 },
    ])
  })
})

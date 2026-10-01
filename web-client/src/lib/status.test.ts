import { describe, expect, it } from 'vitest'
import { pendingMessage } from '../test/fakes'
import { deliveryState } from './status'

// The peer has received up to seq 5 and read up to seq 3.
const watermarks = { peer_delivered_up_to_seq: 5, peer_read_up_to_seq: 3 }
const acked = (seq: number) => pendingMessage({ seq, status: 'sent' })

describe('deliveryState', () => {
  it('shows pending messages as sending while online, queued while offline', () => {
    const pending = pendingMessage()
    expect(deliveryState(pending, watermarks, true)).toBe('sending')
    expect(deliveryState(pending, watermarks, false)).toBe('queued')
  })

  it('shows failed messages as failed', () => {
    expect(deliveryState(pendingMessage({ status: 'failed' }), watermarks, true)).toBe('failed')
  })

  it('derives sent, delivered and read from the peer’s watermarks', () => {
    expect(deliveryState(acked(3), watermarks, true)).toBe('read')
    expect(deliveryState(acked(4), watermarks, true)).toBe('delivered')
    expect(deliveryState(acked(5), watermarks, true)).toBe('delivered')
    expect(deliveryState(acked(6), watermarks, true)).toBe('sent')
  })

  it('keeps acked messages’ state while offline', () => {
    expect(deliveryState(acked(3), watermarks, false)).toBe('read')
  })
})

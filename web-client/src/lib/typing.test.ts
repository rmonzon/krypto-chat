import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeSocket } from '../test/fakes'
import { TYPING_EXPIRE_MS, TYPING_RESEND_MS, TypingSender, TypingTracker } from './typing'

const start = { type: 'typing', conversation_id: 'c', typing: true }
const stop = { type: 'typing', conversation_id: 'c', typing: false }

describe('TypingSender', () => {
  function setup() {
    const socket = fakeSocket()
    let now = 0
    const sender = new TypingSender(socket, () => now)
    return { socket, sender, advance: (ms: number) => (now += ms) }
  }

  it('announces typing once per resend window while the draft changes', () => {
    const { socket, sender, advance } = setup()
    sender.draftChanged('c', 'h')
    sender.draftChanged('c', 'he')
    advance(TYPING_RESEND_MS - 1)
    sender.draftChanged('c', 'hel')
    expect(socket.sent).toEqual([start])

    advance(1)
    sender.draftChanged('c', 'hell')
    expect(socket.sent).toEqual([start, start])
  })

  it('sends a stop when the draft empties or on stop(), but only after a start', () => {
    const { socket, sender } = setup()
    sender.stop('c')
    sender.draftChanged('c', '   ')
    expect(socket.sent).toEqual([])

    sender.draftChanged('c', 'hi')
    sender.draftChanged('c', '')
    sender.draftChanged('c', 'hi again')
    sender.stop('c')
    sender.stop('c')
    expect(socket.sent).toEqual([start, stop, start, stop])
  })

  it("retries the start on the next keystroke if the socket couldn't send it", () => {
    const { socket, sender } = setup()
    socket.status = 'offline'
    sender.draftChanged('c', 'h')
    socket.status = 'online'
    sender.draftChanged('c', 'hi')
    expect(socket.sent).toEqual([start])
  })

  it('announces again after a reset (reconnect)', () => {
    const { socket, sender } = setup()
    sender.draftChanged('c', 'h')
    sender.reset()
    sender.draftChanged('c', 'hi')
    expect(socket.sent).toEqual([start, start])
  })
})

describe('TypingTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks typing per conversation and notifies only on changes', () => {
    const tracker = new TypingTracker()
    const seen: string[][] = []
    tracker.subscribe((typing) => seen.push([...typing]))

    tracker.update('a', true)
    tracker.update('a', true)
    tracker.update('b', true)
    tracker.update('a', false)

    expect(seen).toEqual([['a'], ['a', 'b'], ['b']])
    expect([...tracker.current()]).toEqual(['b'])
    tracker.clearAll()
  })

  it('expires an indicator that is not refreshed', () => {
    vi.useFakeTimers()
    const tracker = new TypingTracker()

    tracker.update('a', true)
    vi.advanceTimersByTime(TYPING_EXPIRE_MS - 1)
    tracker.update('a', true) // refresh restarts the window
    vi.advanceTimersByTime(TYPING_EXPIRE_MS - 1)
    expect(tracker.current().has('a')).toBe(true)

    vi.advanceTimersByTime(1)
    expect(tracker.current().has('a')).toBe(false)
  })

  it('clears everything on disconnect', () => {
    const tracker = new TypingTracker()
    tracker.update('a', true)
    tracker.update('b', true)
    tracker.clearAll()
    expect(tracker.current().size).toBe(0)
  })
})

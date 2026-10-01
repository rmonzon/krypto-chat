import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSocket, type ConnectionStatus } from './socket'

/** Stands in for the browser WebSocket: tests drive open, messages and drops by hand. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  readonly sent: unknown[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  /** Our side closing it; the browser then fires close. */
  close() {
    this.drop()
  }

  /** The connection going away (server restart, network loss). */
  drop() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }

  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) })
  }
}

const sockets = () => FakeWebSocket.instances
const latest = () => sockets().at(-1)!

/** Lets the async onopen handler (which awaits the token) finish. */
const settle = () => vi.advanceTimersByTimeAsync(0)

let browser: EventTarget

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  browser = new EventTarget()
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('window', browser)
  vi.stubGlobal('location', { protocol: 'https:', host: 'chat.test' })
  // No jitter: each backoff waits exactly its base delay.
  vi.spyOn(Math, 'random').mockReturnValue(1)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(token: string | null = 'token-1') {
  const socket = new ChatSocket(async () => token)
  const statuses: ConnectionStatus[] = []
  const events: unknown[] = []
  socket.onStatus((s) => statuses.push(s))
  socket.onEvent((e) => events.push(e))
  return { socket, statuses, events }
}

/** Opens the latest connection and completes the auth handshake. */
async function connect() {
  latest().onopen?.()
  await settle()
  latest().receive({ type: 'ready', user_id: 'me' })
}

describe('ChatSocket', () => {
  it('authenticates with the first message and only accepts sends once ready', async () => {
    const { socket, statuses, events } = setup()
    socket.start()
    expect(latest().url).toBe('wss://chat.test/ws')
    expect(socket.status).toBe('connecting')

    latest().onopen?.()
    await settle()
    expect(latest().sent).toEqual([{ type: 'auth', token: 'token-1' }])
    const typing = { type: 'typing', conversation_id: 'c', typing: true } as const
    expect(socket.send(typing)).toBe(false)

    latest().receive({ type: 'ready', user_id: 'me' })
    expect(socket.status).toBe('online')
    expect(statuses).toEqual(['connecting', 'online'])
    expect(events).toEqual([{ type: 'ready', user_id: 'me' }])
    expect(socket.send(typing)).toBe(true)
    expect(latest().sent.at(-1)).toEqual(typing)
  })

  it('closes the connection when there is no token', async () => {
    const { socket } = setup(null)
    socket.start()
    latest().onopen?.()
    await settle()
    expect(latest().sent).toEqual([])
    expect(latest().closed).toBe(true)
    expect(socket.status).toBe('offline')
  })

  it('reconnects with exponential backoff, starting over once a connection is ready', async () => {
    const { socket } = setup()
    socket.start()
    await connect()

    latest().drop()
    expect(socket.status).toBe('offline')
    expect(socket.send({ type: 'typing', conversation_id: 'c', typing: false })).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(sockets()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(2)

    // Fails again before it's ready: the next wait doubles.
    latest().drop()
    await vi.advanceTimersByTimeAsync(1999)
    expect(sockets()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(3)

    // Ready resets the backoff.
    await connect()
    latest().drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets()).toHaveLength(4)
  })

  it('caps the backoff at 30 seconds', async () => {
    const { socket } = setup()
    socket.start()
    for (let i = 0; i < 10; i++) {
      latest().drop()
      await vi.advanceTimersByTimeAsync(30_000)
    }
    const before = sockets().length
    latest().drop()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(sockets()).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(before + 1)
  })

  it('reconnect() replaces the connection at once and ignores the old one closing', async () => {
    const { socket } = setup()
    socket.start()
    await connect()
    const old = latest()

    socket.reconnect()
    expect(old.closed).toBe(true)
    expect(sockets()).toHaveLength(2)
    expect(socket.status).toBe('connecting')

    // The old connection's close didn't schedule a reconnect of its own.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(2)
  })

  it('does not authenticate a connection replaced while fetching the token', async () => {
    let resolveToken: (token: string) => void = () => {}
    const socket = new ChatSocket(() => new Promise((resolve) => (resolveToken = resolve)))
    socket.start()
    const old = latest()
    old.onopen?.()
    socket.reconnect()

    resolveToken('token-1')
    await settle()
    expect(old.sent).toEqual([])
  })

  it('sends refreshed tokens on an authenticated connection only', async () => {
    const { socket } = setup()
    socket.start()
    latest().onopen?.()
    await settle()
    socket.refreshToken('too-early')
    expect(latest().sent).toEqual([{ type: 'auth', token: 'token-1' }])

    latest().receive({ type: 'ready', user_id: 'me' })
    socket.refreshToken('token-2')
    expect(latest().sent.at(-1)).toEqual({ type: 'auth', token: 'token-2' })

    latest().drop()
    socket.refreshToken('token-3')
    expect(latest().sent.at(-1)).toEqual({ type: 'auth', token: 'token-2' })
  })

  it('stop() closes the connection and never reconnects', async () => {
    const { socket } = setup()
    socket.start()
    await connect()

    socket.stop()
    expect(latest().closed).toBe(true)
    expect(socket.status).toBe('offline')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(1)

    browser.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(1)
  })

  it('reconnects right away when the browser comes back online', async () => {
    const { socket } = setup()
    socket.start()
    await connect()

    // While connected, the online event changes nothing.
    browser.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(1)

    latest().drop()
    browser.dispatchEvent(new Event('online'))
    expect(sockets()).toHaveLength(2)
    // The pending backoff timer was cancelled.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets()).toHaveLength(2)
  })
})

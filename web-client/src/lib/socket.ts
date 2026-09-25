import type { ClientEvent, ServerEvent } from './types'

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

const MAX_BACKOFF_MS = 30_000

/**
 * WebSocket to api-server: authenticates with the first message, reconnects
 * with exponential backoff, and only accepts sends once the server says ready.
 */
export class ChatSocket {
  status: ConnectionStatus = 'offline'

  private readonly getToken: () => Promise<string | null>
  private ws: WebSocket | null = null
  private ready = false
  private stopped = true
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly eventListeners = new Set<(event: ServerEvent) => void>()
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>()

  constructor(getToken: () => Promise<string | null>) {
    this.getToken = getToken
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    window.addEventListener('online', this.reconnectNow)
    this.connect()
  }

  stop() {
    this.stopped = true
    window.removeEventListener('online', this.reconnectNow)
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    this.ready = false
    ws?.close()
    this.setStatus('offline')
  }

  /** Drops the current connection and reconnects right away, e.g. when acks stop arriving. */
  reconnect() {
    if (this.stopped) return
    const ws = this.ws
    this.ws = null
    this.ready = false
    ws?.close()
    clearTimeout(this.retryTimer)
    this.setStatus('offline')
    this.attempt = 0
    this.connect()
  }

  /** Returns false if the socket isn't ready; the caller decides what to do. */
  send(event: ClientEvent): boolean {
    if (!this.ready || !this.ws) return false
    this.ws.send(JSON.stringify(event))
    return true
  }

  onEvent(listener: (event: ServerEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private connect() {
    this.setStatus('connecting')
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = async () => {
      const token = await this.getToken()
      if (ws !== this.ws) return
      if (!token) return ws.close()
      ws.send(JSON.stringify({ type: 'auth', token }))
    }

    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as ServerEvent
      if (event.type === 'ready') {
        this.ready = true
        this.attempt = 0
        this.setStatus('online')
      }
      for (const listener of this.eventListeners) listener(event)
    }

    ws.onclose = () => {
      if (ws !== this.ws) return // stopped, or replaced by a newer connection
      this.ws = null
      this.ready = false
      this.setStatus('offline')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt)
    this.attempt++
    // Jitter so many clients don't reconnect in lockstep after a server restart.
    this.retryTimer = setTimeout(() => this.connect(), base * (0.5 + Math.random() / 2))
  }

  private reconnectNow = () => {
    if (this.stopped || this.ws) return
    clearTimeout(this.retryTimer)
    this.attempt = 0
    this.connect()
  }

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }
}

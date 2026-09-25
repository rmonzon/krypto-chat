import { getChatDb } from '../lib/db'
import type { ChatSocket, ConnectionStatus } from '../lib/socket'
import type { ClientEvent, Message, ServerMessage } from '../lib/types'

/** A fresh local database per test. */
export function freshDb() {
  return getChatDb(`test-${crypto.randomUUID()}`)
}

/** Stands in for ChatSocket: records sends, refuses them while not online. */
export function fakeSocket(status: ConnectionStatus = 'online') {
  const fake = {
    status,
    sent: [] as ClientEvent[],
    reconnects: 0,
    send(event: ClientEvent) {
      if (fake.status !== 'online') return false
      fake.sent.push(event)
      return true
    },
    reconnect() {
      fake.reconnects++
    },
  }
  return fake as typeof fake & ChatSocket
}

let clock = 0

export function pendingMessage(overrides: Partial<Message> = {}): Message {
  return {
    client_msg_id: crypto.randomUUID(),
    conversation_id: 'conv-1',
    sender_id: 'me',
    content_type: 'text/plain',
    body: 'hi',
    seq: null,
    // Increasing timestamps so send order is deterministic.
    created_at: new Date(Date.UTC(2026, 0, 1) + clock++ * 1000).toISOString(),
    status: 'sending',
    ...overrides,
  }
}

export function serverMessage(overrides: Partial<ServerMessage> = {}): ServerMessage {
  return {
    id: crypto.randomUUID(),
    conversation_id: 'conv-1',
    seq: 1,
    sender_id: 'peer',
    client_msg_id: crypto.randomUUID(),
    content_type: 'text/plain',
    body: 'hello',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** A minimal exclusive Web Locks implementation (Node has no navigator.locks). */
export function fakeLocks(): Pick<LockManager, 'request'> {
  const held = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()

  function request(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const run = () => {
        held.add(name)
        callback({ name, mode: 'exclusive' } as Lock)
          .then(resolve, reject)
          .finally(() => {
            held.delete(name)
            waiting.get(name)?.shift()?.()
          })
      }
      if (!held.has(name)) return run()
      const queue = waiting.get(name) ?? []
      waiting.set(name, queue)
      queue.push(run)
      options.signal?.addEventListener('abort', () => {
        const index = queue.indexOf(run)
        if (index !== -1) {
          queue.splice(index, 1)
          reject(new DOMException('Aborted', 'AbortError'))
        }
      })
    })
  }
  return { request: request as LockManager['request'] }
}

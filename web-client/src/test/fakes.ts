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
    send(event: ClientEvent) {
      if (fake.status !== 'online') return false
      fake.sent.push(event)
      return true
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

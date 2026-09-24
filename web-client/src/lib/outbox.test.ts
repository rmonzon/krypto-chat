import { describe, expect, it, vi } from 'vitest'
import { fakeSocket, freshDb, pendingMessage } from '../test/fakes'
import { Outbox } from './outbox'

function setup(status: 'online' | 'offline' = 'online') {
  const db = freshDb()
  const socket = fakeSocket(status)
  const outbox = new Outbox(db, socket, 'me')
  const statusOf = async (id: string) => (await db.messages.get(['me', id]))?.status
  const sentIds = () => socket.sent.map((e) => (e.type === 'message.send' ? e.client_msg_id : e.type))
  return { db, socket, outbox, statusOf, sentIds }
}

function ack(clientMsgId: string, seq: number) {
  return {
    type: 'message.ack' as const,
    client_msg_id: clientMsgId,
    conversation_id: 'conv-1',
    seq,
    created_at: '2026-01-01T00:01:00.000Z',
  }
}

describe('Outbox', () => {
  it('sends a message as soon as it is enqueued while online', async () => {
    const { outbox, socket, statusOf } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    expect(socket.sent[0]).toEqual({
      type: 'message.send',
      client_msg_id: m.client_msg_id,
      conversation_id: m.conversation_id,
      content_type: 'text/plain',
      body: 'hi',
    })
    expect(await statusOf(m.client_msg_id)).toBe('sending')
  })

  it('queues while offline and sends in write order once online', async () => {
    const { outbox, socket, sentIds } = setup('offline')
    const messages = [pendingMessage(), pendingMessage(), pendingMessage()]
    for (const m of messages) await outbox.enqueue(m)
    expect(socket.sent).toHaveLength(0)

    socket.status = 'online'
    outbox.onOnline()
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3))
    expect(sentIds()).toEqual(messages.map((m) => m.client_msg_id))
  })

  it('does not resend in-flight messages until a reconnect', async () => {
    const { outbox, socket, sentIds } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))

    await outbox.flush()
    expect(socket.sent).toHaveLength(1)

    outbox.onOnline() // reconnected: the ack may have been lost
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
    expect(sentIds()).toEqual([m.client_msg_id, m.client_msg_id])
  })

  it('marks a message sent with its seq when acked', async () => {
    const { db, outbox, socket } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    await outbox.onAck(ack(m.client_msg_id, 7))

    expect(await db.messages.get(['me', m.client_msg_id])).toMatchObject({
      status: 'sent',
      seq: 7,
      created_at: '2026-01-01T00:01:00.000Z',
    })
    outbox.onOnline()
    await outbox.flush()
    expect(socket.sent).toHaveLength(1) // acked messages are never resent
  })

  it('fails permanently rejected messages without retrying', async () => {
    const { outbox, socket, statusOf } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    await outbox.onError({ type: 'error', reason: 'not_a_member', client_msg_id: m.client_msg_id })

    expect(await statusOf(m.client_msg_id)).toBe('failed')
    await outbox.flush()
    expect(socket.sent).toHaveLength(1)
  })

  it('retries transient errors, then gives up after 5 attempts', async () => {
    const { db, outbox, socket, statusOf } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    const error = { type: 'error' as const, reason: 'internal_error', client_msg_id: m.client_msg_id }

    for (let attempt = 1; attempt < 5; attempt++) {
      await outbox.onError(error)
      expect(await statusOf(m.client_msg_id)).toBe('sending')
    }
    await outbox.onError(error)
    expect(await statusOf(m.client_msg_id)).toBe('failed')
    expect((await db.messages.get(['me', m.client_msg_id]))?.attempts).toBe(5)
  })

  it('resends a failed message on retry', async () => {
    const { outbox, socket, statusOf } = setup()
    const m = pendingMessage()
    await outbox.enqueue(m)
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
    await outbox.onError({ type: 'error', reason: 'invalid_message', client_msg_id: m.client_msg_id })

    await outbox.retry(m.client_msg_id)
    expect(await statusOf(m.client_msg_id)).toBe('sending')
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2))
  })

  it("only sends the current user's pending messages", async () => {
    const { db, outbox, socket } = setup()
    await db.messages.put(pendingMessage({ sender_id: 'someone-else' }))
    await outbox.flush()
    expect(socket.sent).toHaveLength(0)
  })
})

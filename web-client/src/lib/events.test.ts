import { describe, expect, it, vi } from 'vitest'
import { conversation, freshDb, serverMessage } from '../test/fakes'
import { fromServer } from './db'
import { applyServerEvent, inOrder, type EventContext } from './events'

async function setup() {
  const db = freshDb()
  await db.conversations.put(conversation({ peer_delivered_up_to_seq: 2, peer_read_up_to_seq: 1 }))
  const ctx = {
    db,
    myId: 'me',
    outbox: { onAck: vi.fn(async () => {}), onError: vi.fn(async () => {}) },
    receipts: { markDelivered: vi.fn() },
    typing: { update: vi.fn() },
    refreshConversations: vi.fn(async () => {}),
  } satisfies EventContext
  return { db, ctx }
}

const at = '2026-01-02T00:00:00.000Z'

describe('applyServerEvent', () => {
  it('message.ack: tells the outbox, extends the cursor, and bumps the conversation', async () => {
    const { db, ctx } = await setup()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 4 })
    const ack = {
      type: 'message.ack',
      client_msg_id: 'm1',
      conversation_id: 'conv-1',
      seq: 5,
      created_at: at,
      expires_at: null,
    } as const

    await applyServerEvent(ack, ctx)

    expect(ctx.outbox.onAck).toHaveBeenCalledWith(ack)
    expect((await db.cursors.get('conv-1'))?.seq).toBe(5)
    expect((await db.conversations.get('conv-1'))?.last_message_at).toBe(at)
    expect(ctx.refreshConversations).not.toHaveBeenCalled()
  })

  it('message.new from the peer: stores it, clears typing, and marks it delivered', async () => {
    const { db, ctx } = await setup()
    await db.cursors.put({ conversation_id: 'conv-1', seq: 2 })
    const message = serverMessage({ seq: 3, sender_id: 'peer', created_at: at })

    await applyServerEvent({ type: 'message.new', message }, ctx)

    expect(await db.messages.get([message.sender_id, message.client_msg_id])).toMatchObject({
      seq: 3,
      status: 'sent',
    })
    expect(ctx.typing.update).toHaveBeenCalledWith('conv-1', false)
    expect(ctx.receipts.markDelivered).toHaveBeenCalledWith('conv-1', 3)
    expect((await db.cursors.get('conv-1'))?.seq).toBe(3)
    expect((await db.conversations.get('conv-1'))?.last_message_at).toBe(at)
  })

  it('message.new from my other tab: stored, but no receipt and no typing change', async () => {
    const { db, ctx } = await setup()
    const message = serverMessage({ seq: 1, sender_id: 'me' })

    await applyServerEvent({ type: 'message.new', message }, ctx)

    expect(await db.messages.count()).toBe(1)
    expect(ctx.receipts.markDelivered).not.toHaveBeenCalled()
    expect(ctx.typing.update).not.toHaveBeenCalled()
  })

  it('message.new for a conversation we lack: refetches the list', async () => {
    const { ctx } = await setup()
    const message = serverMessage({ conversation_id: 'conv-2', seq: 1 })
    await applyServerEvent({ type: 'message.new', message }, ctx)
    expect(ctx.refreshConversations).toHaveBeenCalledOnce()
  })

  it('message.updated: changes a stored message, but adds nothing missing', async () => {
    const { db, ctx } = await setup()
    const stored = serverMessage({ seq: 1, body: 'hi' })
    await db.messages.put(fromServer(stored))

    const edited = { ...stored, body: 'hello', change_seq: 1 }
    await applyServerEvent({ type: 'message.updated', message: edited }, ctx)
    const unknown = serverMessage({ seq: 2, change_seq: 2 })
    await applyServerEvent({ type: 'message.updated', message: unknown }, ctx)

    expect((await db.messages.toArray()).map((m) => m.body)).toEqual(['hello'])
  })

  it.each(['conversation.new', 'conversation.updated', 'invite.redeemed'] as const)(
    '%s: stores the conversation',
    async (type) => {
      const { db, ctx } = await setup()
      const incoming = conversation({ id: 'conv-2', message_ttl_seconds: 300 })
      await applyServerEvent({ type, conversation: incoming, code: 'KC-X' }, ctx)
      expect(await db.conversations.get('conv-2')).toMatchObject({ message_ttl_seconds: 300 })
    },
  )

  it('receipt.update from the peer: moves their watermarks forward only', async () => {
    const { db, ctx } = await setup()
    const update = { type: 'receipt.update', conversation_id: 'conv-1', user_id: 'peer' } as const

    await applyServerEvent({ ...update, delivered_up_to_seq: 5, read_up_to_seq: 4 }, ctx)
    expect(await db.conversations.get('conv-1')).toMatchObject({
      peer_delivered_up_to_seq: 5,
      peer_read_up_to_seq: 4,
    })

    await applyServerEvent({ ...update, delivered_up_to_seq: 3, read_up_to_seq: 3 }, ctx)
    expect(await db.conversations.get('conv-1')).toMatchObject({
      peer_delivered_up_to_seq: 5,
      peer_read_up_to_seq: 4,
    })
  })

  it('receipt.update from my other tab: moves my read watermark, not the peer’s', async () => {
    const { db, ctx } = await setup()
    await applyServerEvent(
      {
        type: 'receipt.update',
        conversation_id: 'conv-1',
        user_id: 'me',
        delivered_up_to_seq: 9,
        read_up_to_seq: 9,
      },
      ctx,
    )
    expect(await db.conversations.get('conv-1')).toMatchObject({
      my_read_up_to_seq: 9,
      peer_delivered_up_to_seq: 2,
      peer_read_up_to_seq: 1,
    })
  })

  it('typing: tracks the peer, ignores my own', async () => {
    const { ctx } = await setup()
    const typing = { type: 'typing', conversation_id: 'conv-1', typing: true } as const
    await applyServerEvent({ ...typing, user_id: 'peer' }, ctx)
    await applyServerEvent({ ...typing, user_id: 'me' }, ctx)
    expect(ctx.typing.update).toHaveBeenCalledExactlyOnceWith('conv-1', true)
  })

  it('error: hands it to the outbox', async () => {
    const { ctx } = await setup()
    const error = { type: 'error', reason: 'not_a_member', client_msg_id: 'm1' } as const
    await applyServerEvent(error, ctx)
    expect(ctx.outbox.onError).toHaveBeenCalledWith(error)
  })
})

describe('inOrder', () => {
  it('runs calls one at a time, in order', async () => {
    const log: string[] = []
    let finishFirst = () => {}
    const handle = inOrder(async (name: string) => {
      log.push(`start ${name}`)
      if (name === 'a') await new Promise<void>((resolve) => (finishFirst = resolve))
      log.push(`end ${name}`)
    })

    void handle('a')
    const second = handle('b')
    await Promise.resolve()
    expect(log).toEqual(['start a'])

    finishFirst()
    await second
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('keeps going after a call fails', async () => {
    const seen: number[] = []
    const handle = inOrder(async (n: number) => {
      if (n === 1) throw new Error('boom')
      seen.push(n)
    })
    void handle(1)
    await handle(2)
    expect(seen).toEqual([2])
  })
})

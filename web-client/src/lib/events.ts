import {
  advanceCursor,
  advanceMyRead,
  advancePeerReceipts,
  putConversations,
  putServerMessages,
  type ChatDb,
} from './db'
import type { Outbox } from './outbox'
import type { Receipts } from './receipts'
import type { TypingTracker } from './typing'
import type { ServerEvent } from './types'

export type EventContext = {
  db: ChatDb
  myId: string
  outbox: Pick<Outbox, 'onAck' | 'onError'>
  receipts: Pick<Receipts, 'markDelivered'>
  typing: Pick<TypingTracker, 'update'>
  /** Refetches the conversation list, for a message in a conversation we don't have yet. */
  refreshConversations: () => Promise<void>
}

/** Applies one event from the server to the local DB and the client's trackers. */
export async function applyServerEvent(event: ServerEvent, ctx: EventContext) {
  const { db, myId } = ctx
  switch (event.type) {
    case 'message.ack':
      await ctx.outbox.onAck(event)
      await advanceCursor(db, event.conversation_id, event.seq, event.seq)
      await touchConversation(ctx, event.conversation_id, event.created_at)
      break
    case 'message.new': {
      const { message } = event
      const fromPeer = message.sender_id !== myId
      await putServerMessages(db, [message])
      // Their message is here, so they've stopped typing it.
      if (fromPeer) ctx.typing.update(message.conversation_id, false)
      await advanceCursor(db, message.conversation_id, message.seq, message.seq)
      await touchConversation(ctx, message.conversation_id, message.created_at)
      if (fromPeer) ctx.receipts.markDelivered(message.conversation_id, message.seq)
      break
    }
    case 'message.updated':
      // Edited or deleted. Older history that isn't loaded arrives current when fetched.
      await putServerMessages(db, [event.message], { onlyExisting: true })
      break
    // invite.redeemed: someone used our invite; the Add peer screen reacts to it too.
    case 'invite.redeemed':
    case 'conversation.new':
    case 'conversation.updated':
      await putConversations(db, [event.conversation])
      break
    case 'receipt.update':
      if (event.user_id === myId) {
        // Read in another tab: clear the unread count here too.
        await advanceMyRead(db, event.conversation_id, event.read_up_to_seq)
      } else {
        await advancePeerReceipts(
          db,
          event.conversation_id,
          event.delivered_up_to_seq,
          event.read_up_to_seq,
        )
      }
      break
    case 'typing':
      if (event.user_id !== myId) ctx.typing.update(event.conversation_id, event.typing)
      break
    case 'error':
      await ctx.outbox.onError(event)
      break
  }
}

/** Bumps the conversation's activity time, fetching the list if we don't have it yet. */
async function touchConversation(ctx: EventContext, conversationId: string, at: string) {
  const found = await ctx.db.conversations.update(conversationId, { last_message_at: at })
  if (!found) await ctx.refreshConversations()
}

/**
 * Wraps an async handler so calls run one at a time, in the order they were
 * made, like the server handles each socket's events. Otherwise an ack and
 * the next message could race to move the cursor. A failed call doesn't
 * stop later ones; the next sync repairs whatever it missed.
 */
export function inOrder<T>(handler: (value: T) => Promise<void>): (value: T) => Promise<void> {
  let queue = Promise.resolve()
  return (value) => (queue = queue.then(() => handler(value)).catch(() => {}))
}

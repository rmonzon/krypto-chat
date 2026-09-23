import type { Message, MessageStatus, ServerMessage } from '../lib/types'

/** Messages per conversation, plus which conversations have loaded history. */
export type MessagesState = {
  byConversation: Record<string, Message[]>
  loaded: Record<string, boolean>
}

export type MessagesAction =
  | { type: 'history_loaded'; conversationId: string; messages: ServerMessage[] }
  | { type: 'added'; message: Message }
  | { type: 'received'; message: ServerMessage }
  | {
      type: 'acked'
      conversationId: string
      senderId: string
      clientMsgId: string
      seq: number
      createdAt: string
    }
  | { type: 'status_changed'; clientMsgIds: string[]; status: MessageStatus }
  | { type: 'sending_failed' }

export const initialMessagesState: MessagesState = { byConversation: {}, loaded: {} }

// client_msg_id is only unique per sender.
const keyOf = (m: Message) => `${m.sender_id}:${m.client_msg_id}`

export function fromServer({ id: _id, ...m }: ServerMessage): Message {
  return { ...m, status: 'sent' }
}

// Acked messages in seq order, then pending ones in the order they were written.
function compare(a: Message, b: Message) {
  if (a.seq !== null && b.seq !== null) return a.seq - b.seq
  if (a.seq !== null) return -1
  if (b.seq !== null) return 1
  return a.created_at.localeCompare(b.created_at)
}

function merge(list: Message[] = [], incoming: Message[]): Message[] {
  const byKey = new Map(list.map((m) => [keyOf(m), m]))
  for (const m of incoming) byKey.set(keyOf(m), m)
  return [...byKey.values()].sort(compare)
}

function mapMessages(state: MessagesState, fn: (m: Message) => Message): MessagesState {
  const byConversation: Record<string, Message[]> = {}
  for (const [id, list] of Object.entries(state.byConversation)) byConversation[id] = list.map(fn)
  return { ...state, byConversation }
}

export function messagesReducer(state: MessagesState, action: MessagesAction): MessagesState {
  switch (action.type) {
    case 'history_loaded': {
      const { conversationId } = action
      return {
        byConversation: {
          ...state.byConversation,
          [conversationId]: merge(
            state.byConversation[conversationId],
            action.messages.map(fromServer),
          ),
        },
        loaded: { ...state.loaded, [conversationId]: true },
      }
    }
    case 'added':
    case 'received': {
      const message = action.type === 'received' ? fromServer(action.message) : action.message
      const id = message.conversation_id
      return {
        ...state,
        byConversation: {
          ...state.byConversation,
          [id]: merge(state.byConversation[id], [message]),
        },
      }
    }
    case 'acked': {
      const list = state.byConversation[action.conversationId] ?? []
      const updated = list.map((m) =>
        m.sender_id === action.senderId && m.client_msg_id === action.clientMsgId
          ? { ...m, seq: action.seq, created_at: action.createdAt, status: 'sent' as const }
          : m,
      )
      return {
        ...state,
        byConversation: { ...state.byConversation, [action.conversationId]: updated.sort(compare) },
      }
    }
    case 'status_changed': {
      const ids = new Set(action.clientMsgIds)
      return mapMessages(state, (m) =>
        m.seq === null && ids.has(m.client_msg_id) ? { ...m, status: action.status } : m,
      )
    }
    case 'sending_failed':
      // The connection dropped; anything unacked may or may not have been stored.
      // Retrying is safe because the server dedupes on client_msg_id.
      return mapMessages(state, (m) => (m.status === 'sending' ? { ...m, status: 'failed' } : m))
  }
}

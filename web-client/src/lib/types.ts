export type Profile = {
  id: string
  username: string
  display_name: string
}

export type Conversation = {
  id: string
  peer: Profile
  last_seq: number
  /** Counts edits/deletes in this conversation; see ServerMessage.change_seq. */
  last_change_seq: number
  created_at: string
  last_message_at: string | null
  /** How far the peer has received / read, as conversation seqs. */
  peer_delivered_up_to_seq: number
  peer_read_up_to_seq: number
  /** How far this user has read; peer messages after it are unread. */
  my_read_up_to_seq: number
}

/** A message as stored by the server. */
export type ServerMessage = {
  id: string
  conversation_id: string
  seq: number
  sender_id: string
  client_msg_id: string
  content_type: string
  body: string
  created_at: string
  edited_at: string | null
  /** Set when the sender deleted it; body is then empty. */
  deleted_at: string | null
  /** The conversation change (edit/delete) that last touched it; null if never changed. */
  change_seq: number | null
}

/** Fields that only change through edits/deletes; missing on pending messages. */
type ChangeFields = 'edited_at' | 'deleted_at' | 'change_seq'

export type MessageStatus = 'sending' | 'sent' | 'failed'

/** A message as the client tracks it; seq is null until the server acks it. */
export type Message = Omit<ServerMessage, 'id' | 'seq' | ChangeFields> &
  Partial<Pick<ServerMessage, ChangeFields>> & {
  seq: number | null
  status: MessageStatus
  /** Transient server errors so far; the outbox gives up after a few. */
  attempts?: number
}

export type ClientEvent =
  | {
      type: 'message.send'
      client_msg_id: string
      conversation_id: string
      content_type: string
      body: string
    }
  | { type: 'receipt.delivered' | 'receipt.read'; conversation_id: string; seq: number }
  | { type: 'typing'; conversation_id: string; typing: boolean }

export type ServerEvent =
  | { type: 'ready'; user_id: string }
  | {
      type: 'message.ack'
      client_msg_id: string
      conversation_id: string
      seq: number
      created_at: string
    }
  | { type: 'message.new'; message: ServerMessage }
  /** A message was edited or deleted (its current state). */
  | { type: 'message.updated'; message: ServerMessage }
  | { type: 'conversation.new'; conversation: Conversation }
  | {
      type: 'receipt.update'
      conversation_id: string
      user_id: string
      delivered_up_to_seq: number
      read_up_to_seq: number
    }
  | { type: 'invite.redeemed'; code: string; conversation: Conversation }
  | { type: 'typing'; conversation_id: string; user_id: string; typing: boolean }
  | { type: 'error'; reason: string; client_msg_id?: string }

export type Invite = { code: string; expires_at: string }

export type SyncResponse = {
  conversations: Conversation[]
  messages: ServerMessage[]
  /** Current state of messages edited/deleted after the change cursors. */
  changes: ServerMessage[]
  has_more: boolean
}

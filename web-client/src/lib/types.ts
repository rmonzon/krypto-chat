export type Profile = {
  id: string
  username: string
  display_name: string
}

export type Conversation = {
  id: string
  peer: Profile
  last_seq: number
  created_at: string
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
}

export type MessageStatus = 'sending' | 'sent' | 'failed'

/** A message as the client tracks it; seq is null until the server acks it. */
export type Message = Omit<ServerMessage, 'id' | 'seq'> & {
  seq: number | null
  status: MessageStatus
}

export type ClientEvent = {
  type: 'message.send'
  client_msg_id: string
  conversation_id: string
  content_type: string
  body: string
}

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
  | { type: 'conversation.new'; conversation: Conversation }
  | { type: 'error'; reason: string; client_msg_id?: string }

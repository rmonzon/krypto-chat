import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api } from '../lib/api'
import { ChatSocket, type ConnectionStatus } from '../lib/socket'
import { supabase } from '../lib/supabase'
import type { Conversation, Message, Profile, ServerMessage } from '../lib/types'
import { UserSearch } from '../users/UserSearch'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'
import { initialMessagesState, messagesReducer } from './messages'

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null

const statusText: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
}

export function ChatHome({ profile }: { profile: Profile }) {
  const [socket] = useState(() => new ChatSocket(getToken))
  const [connection, setConnection] = useState<ConnectionStatus>(socket.status)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, dispatch] = useReducer(messagesReducer, initialMessagesState)
  const [error, setError] = useState<string | null>(null)

  // Read by the socket listener, which is registered once.
  const knownConversations = useRef(new Set<string>())
  useEffect(() => {
    knownConversations.current = new Set(conversations.map((c) => c.id))
  }, [conversations])

  const loadConversations = useCallback(() => {
    api<{ conversations: Conversation[] }>('/conversations')
      .then(({ conversations }) => setConversations(conversations))
      .catch(() => setError('Could not load conversations.'))
  }, [])

  const addConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) =>
      prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev],
    )
  }, [])

  const moveToTop = useCallback((conversationId: string) => {
    setConversations((prev) => {
      const target = prev.find((c) => c.id === conversationId)
      return target ? [target, ...prev.filter((c) => c !== target)] : prev
    })
  }, [])

  useEffect(loadConversations, [loadConversations])

  useEffect(() => {
    const offStatus = socket.onStatus((status) => {
      setConnection(status)
      if (status === 'offline') dispatch({ type: 'sending_failed' })
    })
    const offEvent = socket.onEvent((event) => {
      switch (event.type) {
        case 'message.ack':
          dispatch({
            type: 'acked',
            conversationId: event.conversation_id,
            senderId: profile.id,
            clientMsgId: event.client_msg_id,
            seq: event.seq,
            createdAt: event.created_at,
          })
          moveToTop(event.conversation_id)
          break
        case 'message.new':
          dispatch({ type: 'received', message: event.message })
          if (knownConversations.current.has(event.message.conversation_id)) {
            moveToTop(event.message.conversation_id)
          } else {
            loadConversations()
          }
          break
        case 'conversation.new':
          addConversation(event.conversation)
          break
        case 'error':
          if (event.client_msg_id) {
            dispatch({ type: 'status_changed', clientMsgIds: [event.client_msg_id], status: 'failed' })
          }
          break
      }
    })
    socket.start()
    return () => {
      offStatus()
      offEvent()
      socket.stop()
    }
  }, [socket, profile.id, loadConversations, addConversation, moveToTop])

  // Load history the first time a conversation is opened.
  useEffect(() => {
    if (!selectedId || messages.loaded[selectedId]) return
    api<{ messages: ServerMessage[] }>(`/conversations/${selectedId}/messages`)
      .then(({ messages }) =>
        dispatch({ type: 'history_loaded', conversationId: selectedId, messages }),
      )
      .catch(() => setError('Could not load messages.'))
  }, [selectedId, messages.loaded])

  async function openConversationWith(user: Profile) {
    setError(null)
    try {
      const conversation = await api<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ peer_id: user.id }),
      })
      addConversation(conversation)
      setSelectedId(conversation.id)
    } catch {
      setError(`Could not start a conversation with @${user.username}.`)
    }
  }

  function transmit(message: Message) {
    const sent = socket.send({
      type: 'message.send',
      client_msg_id: message.client_msg_id,
      conversation_id: message.conversation_id,
      content_type: message.content_type,
      body: message.body,
    })
    // Offline: fail now. Step 5 replaces this with a persistent outbox.
    if (!sent) {
      dispatch({ type: 'status_changed', clientMsgIds: [message.client_msg_id], status: 'failed' })
    }
  }

  function sendMessage(conversationId: string, body: string) {
    const message: Message = {
      client_msg_id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender_id: profile.id,
      content_type: 'text/plain',
      body,
      seq: null,
      created_at: new Date().toISOString(),
      status: 'sending',
    }
    dispatch({ type: 'added', message })
    transmit(message)
  }

  function retry(message: Message) {
    dispatch({ type: 'status_changed', clientMsgIds: [message.client_msg_id], status: 'sending' })
    transmit(message)
  }

  const selected = conversations.find((c) => c.id === selectedId)

  return (
    <div className="chat">
      <aside className="stack">
        <header className="row">
          <span>
            <strong>{profile.display_name}</strong>{' '}
            <span className="muted">@{profile.username}</span>
          </span>
          <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </header>
        <p className={`connection ${connection}`}>{statusText[connection]}</p>
        <UserSearch onSelect={openConversationWith} />
        {error && <p className="error">{error}</p>}
        <h2>Conversations</h2>
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>
      <main>
        {selected ? (
          <ConversationView
            key={selected.id}
            conversation={selected}
            messages={messages.byConversation[selected.id] ?? []}
            loaded={messages.loaded[selected.id] ?? false}
            myId={profile.id}
            onSend={(body) => sendMessage(selected.id, body)}
            onRetry={retry}
          />
        ) : (
          <p className="muted">Select a conversation.</p>
        )}
      </main>
    </div>
  )
}

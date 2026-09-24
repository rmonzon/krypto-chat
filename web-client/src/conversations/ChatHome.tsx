import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { api } from '../lib/api'
import { compareConversations, fromServer, type ChatDb } from '../lib/db'
import { Outbox } from '../lib/outbox'
import { Receipts } from '../lib/receipts'
import { ChatSocket, type ConnectionStatus } from '../lib/socket'
import { supabase } from '../lib/supabase'
import type { Conversation, Message, Profile, ServerMessage } from '../lib/types'
import { UserSearch } from '../users/UserSearch'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null

const statusText: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
}

export function ChatHome({ profile, db }: { profile: Profile; db: ChatDb }) {
  const [socket] = useState(() => new ChatSocket(getToken))
  const [outbox] = useState(() => new Outbox(db, socket, profile.id))
  const [receipts] = useState(() => new Receipts(socket))
  const [connection, setConnection] = useState<ConnectionStatus>(socket.status)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Conversations whose latest history page was fetched this session.
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const conversations = useLiveQuery(
    async () => (await db.conversations.toArray()).sort(compareConversations),
    [db],
  )

  const loadConversations = useCallback(async () => {
    try {
      const { conversations } = await api<{ conversations: Conversation[] }>('/conversations')
      await db.conversations.bulkPut(conversations)
    } catch {
      // Offline: the cached list is still shown.
    }
  }, [db])

  const touchConversation = useCallback(
    async (conversationId: string, at: string) => {
      const found = await db.conversations.update(conversationId, { last_message_at: at })
      if (!found) await loadConversations()
    },
    [db, loadConversations],
  )

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const offStatus = socket.onStatus((status) => {
      setConnection(status)
      if (status === 'online') {
        outbox.onOnline()
        receipts.onOnline()
      }
    })
    const offEvent = socket.onEvent(async (event) => {
      switch (event.type) {
        case 'message.ack':
          await outbox.onAck(event)
          await touchConversation(event.conversation_id, event.created_at)
          break
        case 'message.new': {
          const { message } = event
          await db.messages.put(fromServer(message))
          await touchConversation(message.conversation_id, message.created_at)
          if (message.sender_id !== profile.id) receipts.markDelivered(message.conversation_id, message.seq)
          break
        }
        case 'conversation.new':
          await db.conversations.put(event.conversation)
          break
        case 'receipt.update':
          // Our own receipts (from other tabs) don't change any message status.
          if (event.user_id !== profile.id) {
            await db.conversations
              .where('id')
              .equals(event.conversation_id)
              .modify((c) => {
                // ?? 0: conversations cached before receipts existed lack these fields.
                c.peer_delivered_up_to_seq = Math.max(
                  c.peer_delivered_up_to_seq ?? 0,
                  event.delivered_up_to_seq,
                )
                c.peer_read_up_to_seq = Math.max(c.peer_read_up_to_seq ?? 0, event.read_up_to_seq)
              })
          }
          break
        case 'error':
          await outbox.onError(event)
          break
      }
    })
    socket.start()
    return () => {
      offStatus()
      offEvent()
      socket.stop()
    }
  }, [socket, outbox, receipts, db, profile.id, touchConversation])

  // Fetch the latest page of history the first time a conversation is opened
  // this session. Cached messages show immediately in the meantime.
  useEffect(() => {
    if (!selectedId || loaded[selectedId]) return
    api<{ messages: ServerMessage[] }>(`/conversations/${selectedId}/messages`)
      .then(async ({ messages }) => {
        await db.messages.bulkPut(messages.map(fromServer))
        setLoaded((prev) => ({ ...prev, [selectedId]: true }))
        const peerSeqs = messages.filter((m) => m.sender_id !== profile.id).map((m) => m.seq)
        if (peerSeqs.length) receipts.markDelivered(selectedId, Math.max(...peerSeqs))
      })
      .catch(() => setError('Could not load messages. Showing cached history.'))
  }, [selectedId, loaded, db, profile.id, receipts])

  async function openConversationWith(user: Profile) {
    setError(null)
    try {
      const conversation = await api<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ peer_id: user.id }),
      })
      await db.conversations.put(conversation)
      setSelectedId(conversation.id)
    } catch {
      setError(`Could not start a conversation with @${user.username}.`)
    }
  }

  async function sendMessage(conversationId: string, body: string) {
    const now = new Date().toISOString()
    const message: Message = {
      client_msg_id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender_id: profile.id,
      content_type: 'text/plain',
      body,
      seq: null,
      created_at: now,
      status: 'sending',
    }
    await outbox.enqueue(message)
    await db.conversations.update(conversationId, { last_message_at: now })
  }

  const markRead = useCallback(
    (seq: number) => {
      if (selectedId) receipts.markRead(selectedId, seq)
    },
    [receipts, selectedId],
  )

  const selected = conversations?.find((c) => c.id === selectedId)

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
          conversations={conversations ?? []}
          selectedId={selectedId}
          onSelect={(id) => {
            setError(null)
            setSelectedId(id)
          }}
        />
      </aside>
      <main>
        {selected ? (
          <ConversationView
            key={selected.id}
            db={db}
            conversation={selected}
            loaded={loaded[selected.id] ?? false}
            online={connection === 'online'}
            myId={profile.id}
            onSend={(body) => void sendMessage(selected.id, body)}
            onRetry={(m) => void outbox.retry(m.client_msg_id)}
            onRead={markRead}
          />
        ) : (
          <p className="muted">Select a conversation.</p>
        )}
      </main>
    </div>
  )
}

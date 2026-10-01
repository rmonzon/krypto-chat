import { useCallback, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { api } from '../lib/api'
import { advanceMyRead, compareConversations, putConversations, type ChatDb } from '../lib/db'
import { changeMessage } from '../lib/edits'
import { applyServerEvent, inOrder } from '../lib/events'
import { purgeExpired } from '../lib/expiry'
import { loadLatestMessages, loadOlderMessages } from '../lib/history'
import { Outbox } from '../lib/outbox'
import { Receipts } from '../lib/receipts'
import { ChatSocket, type ConnectionStatus } from '../lib/socket'
import { Syncer } from '../lib/sync'
import { TypingSender, TypingTracker } from '../lib/typing'
import { supabase } from '../lib/supabase'
import { Brand } from '../ui/Brand'
import { Clock } from '../ui/Clock'
import { Icon } from '../ui/Icon'
import type { Conversation, Message, Profile, ServerEvent } from '../lib/types'
import { AddPeerScreen } from '../invites/AddPeerScreen'
import { IdentityScreen } from '../profile/IdentityScreen'
import { UserSearch } from '../users/UserSearch'
import { ComposeScreen, type Recipient } from './ComposeScreen'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'

// How often local copies of expired messages are deleted (views hide them on time regardless).
const PURGE_INTERVAL_MS = 5_000

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null

type Pane = 'chat' | 'compose' | 'addpeer' | 'identity'

const statusText: Record<ConnectionStatus, string> = {
  connecting: 'connecting…',
  online: 'online',
  offline: 'offline',
}

export function ChatHome({ profile, db }: { profile: Profile; db: ChatDb }) {
  const [socket] = useState(() => new ChatSocket(getToken))
  const [outbox] = useState(() => new Outbox(db, socket, profile.id))
  const [receipts] = useState(() => new Receipts(socket))
  const [syncer] = useState(() => new Syncer(db, profile.id, receipts))
  const [typingSender] = useState(() => new TypingSender(socket))
  const [typingTracker] = useState(() => new TypingTracker())
  // Conversations where the peer is typing right now.
  const [peerTyping, setPeerTyping] = useState<ReadonlySet<string>>(() => typingTracker.current())
  const [connection, setConnection] = useState<ConnectionStatus>(socket.status)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // What the main pane shows besides a conversation.
  const [pane, setPane] = useState<Pane>('chat')
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
      await putConversations(db, conversations)
    } catch {
      // Offline: the cached list is still shown.
    }
  }, [db])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    const offStatus = socket.onStatus((status) => {
      setConnection(status)
      if (status !== 'online') {
        // Stops can't arrive (or be sent) while disconnected.
        typingTracker.clearAll()
        typingSender.reset()
      }
      if (status === 'online') {
        // Resend what we owe the server, then catch up on what we missed.
        outbox.onOnline()
        receipts.onOnline()
        void syncer.run()
      }
    })
    const handleEvent = inOrder((event: ServerEvent) =>
      applyServerEvent(event, {
        db,
        myId: profile.id,
        outbox,
        receipts,
        typing: typingTracker,
        refreshConversations: loadConversations,
      }),
    )
    const offEvent = socket.onEvent((event) => void handleEvent(event))
    const offTyping = typingTracker.subscribe(setPeerTyping)
    outbox.start()
    socket.start()
    return () => {
      offStatus()
      offEvent()
      offTyping()
      typingTracker.clearAll()
      socket.stop()
      outbox.stop()
    }
  }, [
    socket,
    outbox,
    receipts,
    syncer,
    typingSender,
    typingTracker,
    db,
    profile.id,
    loadConversations,
  ])

  // Auto-delete: remove expired messages from the local DB too, not just from view.
  useEffect(() => {
    const purge = () => void purgeExpired(db).catch(() => {})
    purge()
    const timer = setInterval(purge, PURGE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [db])

  // Leaving a conversation (or signing out) stops any "typing" we announced there.
  useEffect(() => {
    if (!selectedId) return
    return () => typingSender.stop(selectedId)
  }, [selectedId, typingSender])

  // Fetch the latest page of history the first time a conversation is opened
  // this session. Cached messages show immediately in the meantime.
  useEffect(() => {
    if (!selectedId || loaded[selectedId]) return
    loadLatestMessages(db, selectedId)
      .then((messages) => {
        setLoaded((prev) => ({ ...prev, [selectedId]: true }))
        const peerSeqs = messages.filter((m) => m.sender_id !== profile.id).map((m) => m.seq)
        if (peerSeqs.length) receipts.markDelivered(selectedId, Math.max(...peerSeqs))
      })
      .catch(() => setError('Could not load messages. Showing cached history.'))
  }, [selectedId, loaded, db, profile.id, receipts])

  function openConversation(id: string) {
    setError(null)
    setPane('chat')
    setSelectedId(id)
  }

  function showPane(next: Exclude<Pane, 'chat'>) {
    setError(null)
    setSelectedId(null)
    setPane(next)
  }

  /** Returns the existing 1:1 conversation with user, or creates it. */
  async function startConversation(user: Profile) {
    const conversation = await api<Conversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ peer_id: user.id }),
    })
    await putConversations(db, [conversation])
    return conversation
  }

  async function openConversationWith(user: Profile) {
    setError(null)
    try {
      openConversation((await startConversation(user)).id)
    } catch {
      setError(`Could not start a conversation with @${user.username}.`)
    }
  }

  async function sendFromCompose(to: Recipient, body: string) {
    const conversationId = 'peer' in to ? to.id : (await startConversation(to)).id
    await sendMessage(conversationId, body)
    openConversation(conversationId)
  }

  async function sendMessage(conversationId: string, body: string) {
    typingSender.stop(conversationId)
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

  /** Turns auto-delete on (seconds) or off (null) for this conversation's new messages. */
  async function setMessageTtl(conversationId: string, ttlSeconds: number | null) {
    const conversation = await api<Conversation>(`/conversations/${conversationId}/ttl`, {
      method: 'PUT',
      body: JSON.stringify({ ttl_seconds: ttlSeconds }),
    })
    await putConversations(db, [conversation])
  }

  const markRead = useCallback(
    (seq: number) => {
      if (!selectedId) return
      receipts.markRead(selectedId, seq)
      void advanceMyRead(db, selectedId, seq)
    },
    [db, receipts, selectedId],
  )

  const loadOlder = useCallback(
    (beforeSeq: number) =>
      selectedId
        ? loadOlderMessages(db, selectedId, beforeSeq)
        : Promise.resolve({ count: 0, hasMore: false }),
    [db, selectedId],
  )

  const selected = conversations?.find((c) => c.id === selectedId)

  // Messages that would be lost by signing out (App deletes the local DB).
  const unsentCount =
    useLiveQuery(() => db.messages.where('status').anyOf('sending', 'failed').count(), [db]) ?? 0
  const [query, setQuery] = useState('')

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    // Offline, the global sign-out can't reach Supabase; still end the session here.
    if (error) await supabase.auth.signOut({ scope: 'local' })
  }

  const peerIds = new Set([profile.id, ...(conversations ?? []).map((c) => c.peer.id)])

  return (
    <div className={'app-main' + (selected || pane !== 'chat' ? ' has-selection' : '')}>
      <aside className="sidebar">
        <div className="screen inbox">
          <header className="topbar">
            <Brand />
            <div className="topbar-actions">
              <button
                type="button"
                className="icon-btn"
                title="Add peer with an invite code"
                aria-label="Add peer"
                aria-pressed={pane === 'addpeer'}
                onClick={() => showPane('addpeer')}
              >
                <Icon name="userPlus" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn accent"
                title="New message"
                aria-label="New message"
                aria-pressed={pane === 'compose'}
                onClick={() => showPane('compose')}
              >
                <Icon name="plus" size={18} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Identity & sign out"
                aria-label="Identity"
                aria-pressed={pane === 'identity'}
                onClick={() => showPane('identity')}
              >
                <Icon name="fingerprint" size={18} />
              </button>
            </div>
          </header>

          <div className="session-strip">
            <span className="ss-id" title={`${profile.display_name} · ${statusText[connection]}`}>
              <span
                className={`dot ${connection === 'online' ? 'live' : connection}`}
                role="img"
                aria-label={statusText[connection]}
              />
              {'@' + profile.username}
            </span>
            <span className="ss-sep" />
            <span>
              <Icon name="signal" size={12} /> {conversations?.length ?? 0}{' '}
              {conversations?.length === 1 ? 'peer' : 'peers'}
            </span>
            {connection !== 'online' && (
              <span className={`ss-status ${connection}`}>{statusText[connection]}</span>
            )}
            <span className="ss-grow" />
            <Clock className="ss-clock" />
          </div>

          <label className="search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search channels or users…"
              aria-label="Search channels or users"
              spellCheck={false}
            />
          </label>

          {error && (
            <p className="sidebar-error" role="alert">
              {error}
            </p>
          )}

          <div className="conv-list">
            <ConversationList
              db={db}
              myId={profile.id}
              conversations={conversations ?? []}
              selectedId={selectedId}
              query={query}
              peerTyping={peerTyping}
              onSelect={openConversation}
            />
            <UserSearch
              query={query}
              excludeIds={peerIds}
              onSelect={(user) => {
                setQuery('')
                void openConversationWith(user)
              }}
            />
          </div>
        </div>
      </aside>
      <main className="main-pane">
        {pane === 'compose' ? (
          <ComposeScreen
            myId={profile.id}
            conversations={conversations ?? []}
            onCancel={() => setPane('chat')}
            onSend={sendFromCompose}
          />
        ) : pane === 'identity' ? (
          <IdentityScreen
            profile={profile}
            conversations={conversations ?? []}
            unsentCount={unsentCount}
            onBack={() => setPane('chat')}
            onAddPeer={() => showPane('addpeer')}
            onOpen={openConversation}
            onSignOut={() => void signOut()}
          />
        ) : pane === 'addpeer' ? (
          <AddPeerScreen
            socket={socket}
            onBack={() => setPane('chat')}
            onAdded={(conversation) => void putConversations(db, [conversation])}
            onOpen={(conversation) => openConversation(conversation.id)}
          />
        ) : selected ? (
          <ConversationView
            key={selected.id}
            db={db}
            conversation={selected}
            loaded={loaded[selected.id] ?? false}
            online={connection === 'online'}
            myId={profile.id}
            myUsername={profile.username}
            onBack={() => setSelectedId(null)}
            peerTyping={peerTyping.has(selected.id)}
            onDraftChange={(draft) => typingSender.draftChanged(selected.id, draft)}
            onSend={(body) => void sendMessage(selected.id, body)}
            onRetry={(m) => void outbox.retry(m.client_msg_id)}
            onEdit={(m, body) => changeMessage(db, m, body)}
            onDelete={(m) => changeMessage(db, m, null)}
            onSetTtl={(ttl) => setMessageTtl(selected.id, ttl)}
            onRead={markRead}
            onLoadOlder={loadOlder}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="empty-state">
      <span className="es-glyph" aria-hidden="true">
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2 4 5.5v6c0 4.6 3.2 7.6 8 8.9 4.8-1.3 8-4.3 8-8.9v-6L12 2Z" />
          <path d="M9 11.5 11 13.5 15.5 9" />
        </svg>
      </span>
      <h3>No channel selected</h3>
      <p>Choose a channel from the left, or search for a username to open a new one.</p>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { putConversations, type ChatDb } from '../lib/db'
import { applyServerEvent, inOrder } from '../lib/events'
import { purgeExpired } from '../lib/expiry'
import { Outbox } from '../lib/outbox'
import { Receipts } from '../lib/receipts'
import { ChatSocket, type ConnectionStatus } from '../lib/socket'
import { Syncer } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { TypingSender, TypingTracker } from '../lib/typing'
import type { Conversation, ServerEvent } from '../lib/types'

// How often local copies of expired messages are deleted (views hide them on time regardless).
const PURGE_INTERVAL_MS = 5_000

const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token ?? null

/**
 * The signed-in user's connection to the server, for as long as the chat UI
 * is mounted: the socket and everything that runs on it (outbox, receipts,
 * sync, typing), the conversation list fetch, and the expired-message purge.
 */
export function useChatClient(db: ChatDb, myId: string) {
  const [socket] = useState(() => new ChatSocket(getToken))
  const [outbox] = useState(() => new Outbox(db, socket, myId))
  const [receipts] = useState(() => new Receipts(socket))
  const [syncer] = useState(() => new Syncer(db, myId, receipts))
  const [typingSender] = useState(() => new TypingSender(socket))
  const [typingTracker] = useState(() => new TypingTracker())
  // Conversations where the peer is typing right now.
  const [peerTyping, setPeerTyping] = useState<ReadonlySet<string>>(() => typingTracker.current())
  const [connection, setConnection] = useState<ConnectionStatus>(socket.status)

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
        myId,
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
  }, [socket, outbox, receipts, syncer, typingSender, typingTracker, db, myId, loadConversations])

  // Auto-delete: remove expired messages from the local DB too, not just from view.
  useEffect(() => {
    const purge = () => void purgeExpired(db).catch(() => {})
    purge()
    const timer = setInterval(purge, PURGE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [db])

  return { socket, outbox, receipts, typingSender, connection, peerTyping }
}

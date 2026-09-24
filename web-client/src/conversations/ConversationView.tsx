import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { compareMessages, type ChatDb } from '../lib/db'
import type { Conversation, Message } from '../lib/types'

type Props = {
  db: ChatDb
  conversation: Conversation
  loaded: boolean
  online: boolean
  myId: string
  onSend: (body: string) => void
  onRetry: (message: Message) => void
  /** Called with the highest peer seq while the conversation is visible. */
  onRead: (seq: number) => void
}

/** What to show under one of my messages. Delivered/read come from the peer's watermarks. */
function statusText(m: Message, conversation: Conversation, online: boolean) {
  switch (m.status) {
    case 'sending':
      return online ? 'Sending…' : 'Queued'
    case 'failed':
      return 'Failed · tap to retry'
    case 'sent':
      if (m.seq === null) return 'Sent'
      if (m.seq <= conversation.peer_read_up_to_seq) return 'Read'
      if (m.seq <= conversation.peer_delivered_up_to_seq) return 'Delivered'
      return 'Sent'
  }
}

export function ConversationView({
  db,
  conversation,
  loaded,
  online,
  myId,
  onSend,
  onRetry,
  onRead,
}: Props) {
  const [draft, setDraft] = useState('')
  const messages = useLiveQuery(
    async () =>
      (await db.messages.where('conversation_id').equals(conversation.id).toArray()).sort(
        compareMessages,
      ),
    [db, conversation.id],
  ) ?? []
  const bottomRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  // Mark the peer's latest message read while this conversation is on screen.
  const latestPeerSeq = Math.max(
    0,
    ...messages.filter((m) => m.sender_id !== myId && m.seq !== null).map((m) => m.seq!),
  )
  useEffect(() => {
    if (!latestPeerSeq) return
    const markIfVisible = () => {
      if (document.visibilityState === 'visible') onRead(latestPeerSeq)
    }
    markIfVisible()
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [latestPeerSeq, onRead])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    onSend(body)
    setDraft('')
  }

  return (
    <section className="conversation">
      <header>
        <strong>{conversation.peer.display_name}</strong>{' '}
        <span className="muted">@{conversation.peer.username}</span>
      </header>

      <ol className="messages">
        {!loaded && messages.length === 0 && <li className="muted">Loading…</li>}
        {loaded && messages.length === 0 && <li className="muted">No messages yet. Say hi!</li>}
        {messages.map((m) => {
          const mine = m.sender_id === myId
          return (
            <li key={`${m.sender_id}:${m.client_msg_id}`} className={mine ? 'bubble mine' : 'bubble'}>
              <div className="body">{m.body}</div>
              {mine &&
                (m.status === 'failed' ? (
                  <button type="button" className="status failed" onClick={() => onRetry(m)}>
                    {statusText(m, conversation, online)}
                  </button>
                ) : (
                  <span className="status">{statusText(m, conversation, online)}</span>
                ))}
            </li>
          )
        })}
        <li ref={bottomRef} aria-hidden />
      </ol>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          placeholder="Message"
          value={draft}
          maxLength={10_000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}

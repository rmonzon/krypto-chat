import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
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
  /** Loads the page before beforeSeq; resolves with how many messages were fetched. */
  onLoadOlder: (beforeSeq: number) => Promise<number>
}

// Stable fallback while the live query loads, so effects keyed on messages don't rerun every render.
const NO_MESSAGES: Message[] = []

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
  onLoadOlder,
}: Props) {
  const [draft, setDraft] = useState('')
  const messages = useLiveQuery(
    async () =>
      (await db.messages.where('conversation_id').equals(conversation.id).toArray()).sort(
        compareMessages,
      ),
    [db, conversation.id],
  ) ?? NO_MESSAGES
  const listRef = useRef<HTMLOListElement>(null)
  const topRef = useRef<HTMLLIElement>(null)
  const bottomRef = useRef<HTMLLIElement>(null)

  // Jump to the bottom when a message is appended (sent, received, or first
  // load), but not when older history is prepended above.
  const last = messages.at(-1)
  const lastKey = last ? `${last.sender_id}:${last.client_msg_id}` : null
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lastKey])

  // Seqs are gap-free from 1, so anything above 1 means there's older history.
  const seqs = messages.filter((m) => m.seq !== null).map((m) => m.seq!)
  const oldestSeq = seqs.length ? Math.min(...seqs) : null
  const hasOlder = oldestSeq !== null && oldestSeq > 1
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderFailed, setOlderFailed] = useState(false)
  // Scroll position captured before prepending, restored once the list grows.
  const anchor = useRef<{ height: number; top: number } | null>(null)

  const loadOlder = useCallback(async () => {
    const list = listRef.current
    if (!list || !hasOlder || loadingOlder) return
    anchor.current = { height: list.scrollHeight, top: list.scrollTop }
    setLoadingOlder(true)
    setOlderFailed(false)
    try {
      if ((await onLoadOlder(oldestSeq)) === 0) anchor.current = null
    } catch {
      anchor.current = null
      setOlderFailed(true)
    } finally {
      setLoadingOlder(false)
    }
  }, [hasOlder, loadingOlder, oldestSeq, onLoadOlder])

  // Keep the reader's place: shift scrollTop by however much was added above.
  useLayoutEffect(() => {
    const list = listRef.current
    const saved = anchor.current
    if (!list || !saved || list.scrollHeight === saved.height) return
    list.scrollTop = saved.top + (list.scrollHeight - saved.height)
    anchor.current = null
  }, [messages])

  // Load older history when the top of the list scrolls into view.
  useEffect(() => {
    const list = listRef.current
    const top = topRef.current
    if (!list || !top || !hasOlder || olderFailed) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadOlder()
      },
      { root: list, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(top)
    return () => observer.disconnect()
  }, [hasOlder, olderFailed, loadOlder])

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

      <ol className="messages" ref={listRef}>
        <li ref={topRef} className="history-edge">
          {loadingOlder && <span className="muted">Loading older messages…</span>}
          {olderFailed && (
            <button type="button" className="link" onClick={() => void loadOlder()}>
              Couldn't load older messages · retry
            </button>
          )}
        </li>
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

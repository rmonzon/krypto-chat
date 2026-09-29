import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { compareMessages, type ChatDb } from '../lib/db'
import { dayKey, formatDayLabel, formatTime } from '../lib/time'
import type { Conversation, Message } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { userColor } from '../ui/colors'
import { Icon, type IconName } from '../ui/Icon'

type Props = {
  db: ChatDb
  conversation: Conversation
  loaded: boolean
  online: boolean
  myId: string
  myUsername: string
  /** Returns to the conversation list (shown on narrow screens). */
  onBack: () => void
  /** Whether the peer is typing right now. */
  peerTyping: boolean
  /** Called on every draft edit, to announce typing. */
  onDraftChange: (draft: string) => void
  onSend: (body: string) => void
  onRetry: (message: Message) => void
  /** Called with the highest peer seq while the conversation is visible. */
  onRead: (seq: number) => void
  /** Loads the page before beforeSeq; resolves with how many messages were fetched. */
  onLoadOlder: (beforeSeq: number) => Promise<number>
}

// Stable fallback while the live query loads, so effects keyed on messages don't rerun every render.
const NO_MESSAGES: Message[] = []

type Status = { label: string; icon: IconName; tone?: 'pending' | 'read' | 'failed' }

/** Delivery state of one of my messages. Delivered/read come from the peer's watermarks. */
function messageStatus(m: Message, conversation: Conversation, online: boolean): Status {
  switch (m.status) {
    case 'sending':
      return online
        ? { label: 'Sending', icon: 'clock', tone: 'pending' }
        : { label: 'Queued until online', icon: 'clock', tone: 'pending' }
    case 'failed':
      return { label: 'Failed to send · retry', icon: 'alert', tone: 'failed' }
    case 'sent':
      if (m.seq !== null && m.seq <= conversation.peer_read_up_to_seq) {
        return { label: 'Read', icon: 'check2', tone: 'read' }
      }
      if (m.seq !== null && m.seq <= conversation.peer_delivered_up_to_seq) {
        return { label: 'Delivered', icon: 'check2' }
      }
      return { label: 'Sent', icon: 'check' }
  }
}

export function ConversationView({
  db,
  conversation,
  loaded,
  online,
  myId,
  myUsername,
  onBack,
  peerTyping,
  onDraftChange,
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

  // Show the typing indicator when it appears, unless the reader has scrolled up into history.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!peerTyping || !list) return
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 120) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [peerTyping])

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

  const peer = conversation.peer
  const peerColor = userColor(peer.username)

  return (
    <section className="screen thread">
      <header className="topbar thread-bar">
        <button type="button" className="icon-btn" aria-label="Back to channels" onClick={onBack}>
          <Icon name="back" size={18} />
        </button>
        <div className="thread-id">
          <Avatar username={peer.username} size={34} />
          <div className="thread-id-txt">
            <h2 className="thread-handle">{peer.display_name}</h2>
            <span className="thread-sub">
              @{peer.username}
              {!online && <span className="thread-offline"> · offline, messages will queue</span>}
            </span>
          </div>
        </div>
      </header>

      <ol className="msg-scroll" ref={listRef}>
        <li ref={topRef} className="history-edge">
          {loadingOlder && <span className="thread-note">loading older messages…</span>}
          {olderFailed && (
            <button type="button" className="kd-fill" onClick={() => void loadOlder()}>
              couldn’t load older messages · retry
            </button>
          )}
        </li>
        {!loaded && messages.length === 0 && <li className="thread-note">loading…</li>}
        {loaded && messages.length === 0 && (
          <li className="thread-note">no messages yet. say hi to @{peer.username}.</li>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === myId
          const day = dayKey(m.created_at)
          const newDay = i === 0 || dayKey(messages[i - 1].created_at) !== day
          const status = mine ? messageStatus(m, conversation, online) : null
          return (
            <Fragment key={`${m.sender_id}:${m.client_msg_id}`}>
              {newDay && (
                <li className="thread-day">
                  <time dateTime={day}>— {formatDayLabel(m.created_at)} —</time>
                </li>
              )}
              <li className={`msg ${mine ? 'mine' : 'theirs'}${m.status === 'sending' ? ' pending' : ''}`}>
                <span className="log-meta">
                  <time className="log-ts" dateTime={m.created_at}>
                    [{formatTime(m.created_at)}]
                  </time>
                  <span className="log-who" style={mine ? undefined : { color: peerColor }}>
                    &lt;{mine ? myUsername : peer.username}&gt;
                  </span>
                </span>
                <span className="msg-body">
                  {m.body}
                  {status &&
                    (status.tone === 'failed' ? (
                      <button type="button" className="msg-status failed" onClick={() => onRetry(m)}>
                        <Icon name={status.icon} size={12} /> {status.label}
                      </button>
                    ) : (
                      <span
                        className={`msg-status ${status.tone ?? ''}`}
                        title={status.label}
                        role="img"
                        aria-label={status.label}
                      >
                        <Icon name={status.icon} size={12} />
                      </span>
                    ))}
                </span>
              </li>
            </Fragment>
          )
        })}
        {peerTyping && (
          <li className="msg theirs typing-row" role="status">
            <span className="log-meta">
              <span className="log-ts">[{formatTime(new Date().toISOString())}]</span>
              <span className="log-who" style={{ color: peerColor }}>
                &lt;{peer.username}&gt;
              </span>
            </span>
            <span className="typing-line">
              <span className="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="typing-cue">typing…</span>
            </span>
          </li>
        )}
        <li ref={bottomRef} aria-hidden />
      </ol>

      <form className="compose-dock" onSubmit={handleSubmit}>
        <input
          placeholder={`message @${peer.username}…`}
          aria-label={`Message @${peer.username}`}
          value={draft}
          maxLength={10_000}
          onChange={(e) => {
            setDraft(e.target.value)
            onDraftChange(e.target.value)
          }}
        />
        <button type="submit" className="send-btn" disabled={!draft.trim()} aria-label="Send">
          <Icon name="send" size={17} />
        </button>
      </form>
    </section>
  )
}

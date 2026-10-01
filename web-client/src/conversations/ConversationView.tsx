import { Fragment, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { compareMessages, msgKey, type ChatDb } from '../lib/db'
import { canChange, changeErrorMessage } from '../lib/edits'
import { isExpired, ttlLabel, ttlNotice } from '../lib/expiry'
import type { OlderPage } from '../lib/history'
import { MAX_BODY_LENGTH } from '../lib/limits'
import { highestPeerSeq } from '../lib/receipts'
import { deliveryState } from '../lib/status'
import { dayKey } from '../lib/time'
import type { Conversation, Message } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { userColor } from '../ui/colors'
import { Icon } from '../ui/Icon'
import { DayDivider, MessageRow, NoticeRow, TypingRow } from './MessageRows'
import { TtlMenu } from './TtlMenu'
import { useOlderHistory } from './useOlderHistory'

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
  /** Saves an edit of one of my messages; rejects if the server refuses it. */
  onEdit: (message: Message, body: string) => Promise<void>
  /** Deletes one of my messages for everyone; rejects if the server refuses it. */
  onDelete: (message: Message) => Promise<void>
  /** Turns auto-delete on (seconds) or off (null) for new messages; rejects on failure. */
  onSetTtl: (ttlSeconds: number | null) => Promise<void>
  /** Called with the highest peer seq while the conversation is visible. */
  onRead: (seq: number) => void
  /** Loads the page before beforeSeq; resolves with its size and whether there's more. */
  onLoadOlder: (beforeSeq: number) => Promise<OlderPage>
}

// Stable fallback while the live query loads, so effects keyed on messages don't rerun every render.
const NO_MESSAGES: Message[] = []

// How often to re-check which messages are still inside the edit window.
const EDIT_WINDOW_TICK_MS = 10_000
// Longest wait between re-renders while messages are due to expire (setTimeout overflows past ~24 days).
const MAX_EXPIRY_WAIT_MS = 60_000

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
  onEdit,
  onDelete,
  onSetTtl,
  onRead,
  onLoadOlder,
}: Props) {
  const [draft, setDraft] = useState('')
  // The message being edited in the compose dock, and the draft it replaced.
  const [editing, setEditing] = useState<Message | null>(null)
  const [savedDraft, setSavedDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [changeBusy, setChangeBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messages = useLiveQuery(
    async () =>
      (await db.messages.where('conversation_id').equals(conversation.id).toArray()).sort(
        compareMessages,
      ),
    [db, conversation.id],
  ) ?? NO_MESSAGES
  const listRef = useRef<HTMLOListElement>(null)
  const bottomRef = useRef<HTMLLIElement>(null)

  // Jump to the bottom when a message is appended (sent, received, or first
  // load), but not when older history is prepended above.
  const last = messages.at(-1)
  const lastKey = last ? msgKey(last) : null
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

  const {
    topRef,
    loading: loadingOlder,
    failed: olderFailed,
    loadOlder,
  } = useOlderHistory(listRef, messages, onLoadOlder)

  // Mark the peer's latest message read while this conversation is on screen.
  const latestPeerSeq = highestPeerSeq(messages, myId)
  useEffect(() => {
    if (!latestPeerSeq) return
    const markIfVisible = () => {
      if (document.visibilityState === 'visible') onRead(latestPeerSeq)
    }
    markIfVisible()
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [latestPeerSeq, onRead])

  // Re-render when the next message expires, and periodically while edit/delete
  // actions are showing (they disappear once a message leaves the edit window).
  const [now, setNow] = useState(() => Date.now())
  const anyChangeable = online && messages.some((m) => canChange(m, myId, now))
  const nextExpiry = Math.min(
    Infinity,
    ...messages.filter((m) => m.expires_at && !isExpired(m, now)).map((m) => Date.parse(m.expires_at!)),
  )
  useEffect(() => {
    if (!anyChangeable && nextExpiry === Infinity) return
    const untilExpiry = nextExpiry - Date.now()
    const delay = Math.min(anyChangeable ? EDIT_WINDOW_TICK_MS : Infinity, untilExpiry, MAX_EXPIRY_WAIT_MS)
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, delay))
    return () => clearTimeout(timer)
  }, [anyChangeable, nextExpiry, now])

  // Hidden the moment they expire; the purge in ChatHome deletes them a few seconds later.
  const visible = messages.filter((m) => !isExpired(m, now))

  function startEditing(m: Message) {
    if (!editing) setSavedDraft(draft)
    onDraftChange('') // editing isn't typing a new message
    setEditing(m)
    setDraft(m.body)
    setConfirmingDelete(null)
    setChangeError(null)
    inputRef.current?.focus()
  }

  function stopEditing() {
    setEditing(null)
    setDraft(savedDraft)
    setSavedDraft('')
  }

  // Stop editing if the message gets deleted or expires meanwhile (adjusted
  // during render: it's derived from the messages, no effect needed).
  const editingDeleted =
    editing !== null &&
    messages.some((m) => msgKey(m) === msgKey(editing) && (m.deleted_at || isExpired(m, now)))
  if (editingDeleted) stopEditing()

  async function runChange(change: () => Promise<void>) {
    setChangeBusy(true)
    setChangeError(null)
    try {
      await change()
      return true
    } catch (err) {
      setChangeError(changeErrorMessage(err))
      return false
    } finally {
      setChangeBusy(false)
    }
  }

  async function chooseTtl(ttlSeconds: number | null) {
    setChangeError(null)
    try {
      await onSetTtl(ttlSeconds)
    } catch {
      setChangeError('couldn’t change auto-delete. check your connection and try again.')
    }
  }

  async function confirmDelete(m: Message) {
    if (await runChange(() => onDelete(m))) setConfirmingDelete(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    if (editing) {
      if (body === editing.body || (await runChange(() => onEdit(editing, body)))) stopEditing()
      return
    }
    onSend(body)
    setDraft('')
  }

  const peer = conversation.peer
  const peerColor = userColor(peer.username)
  // ?? null: conversations cached before auto-delete existed lack it.
  const ttl = conversation.message_ttl_seconds ?? null

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
              {ttl !== null && <span className="thread-ttl"> · auto-delete {ttlLabel(ttl)}</span>}
              {!online && <span className="thread-offline"> · offline, messages will queue</span>}
            </span>
          </div>
        </div>
        <TtlMenu ttl={ttl} online={online} onChoose={(t) => void chooseTtl(t)} />
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
        {!loaded && visible.length === 0 && <li className="thread-note">loading…</li>}
        {loaded && visible.length === 0 && (
          <li className="thread-note">no messages yet. say hi to @{peer.username}.</li>
        )}
        {visible.map((m, i) => {
          const mine = m.sender_id === myId
          const key = msgKey(m)
          const day = dayKey(m.created_at)
          const divider = (i === 0 || dayKey(visible[i - 1].created_at) !== day) && (
            <DayDivider day={day} at={m.created_at} />
          )
          const notice = ttlNotice(m)
          if (notice !== undefined) {
            return (
              <Fragment key={key}>
                {divider}
                <NoticeRow
                  who={mine ? 'you' : `@${peer.username}`}
                  ttlSeconds={notice}
                  at={m.created_at}
                />
              </Fragment>
            )
          }
          const delivery =
            mine && !m.deleted_at ? deliveryState(m, conversation, online) : undefined
          return (
            <Fragment key={key}>
              {divider}
              <MessageRow
                message={m}
                mine={mine}
                username={mine ? myUsername : peer.username}
                color={peerColor}
                delivery={delivery}
                editing={editing !== null && msgKey(editing) === key}
                changeable={online && canChange(m, myId, now)}
                confirmingDelete={confirmingDelete === key}
                busy={changeBusy}
                onRetry={() => onRetry(m)}
                onEdit={() => startEditing(m)}
                onAskDelete={() => {
                  setChangeError(null)
                  setConfirmingDelete(key)
                }}
                onConfirmDelete={() => void confirmDelete(m)}
                onCancelDelete={() => setConfirmingDelete(null)}
              />
            </Fragment>
          )
        })}
        {peerTyping && <TypingRow username={peer.username} color={peerColor} />}
        <li ref={bottomRef} aria-hidden />
      </ol>

      {(editing || changeError) && (
        <div className={'compose-banner' + (changeError ? ' error' : '')} role="status">
          {changeError ?? 'editing message · esc to cancel'}
          {editing && (
            <button type="button" className="msg-act" onClick={stopEditing}>
              cancel
            </button>
          )}
          {!editing && (
            <button type="button" className="msg-act" onClick={() => setChangeError(null)}>
              dismiss
            </button>
          )}
        </div>
      )}
      <form className="compose-dock" onSubmit={(e) => void handleSubmit(e)}>
        <input
          ref={inputRef}
          placeholder={editing ? 'edit message…' : `message @${peer.username}…`}
          aria-label={editing ? 'Edit message' : `Message @${peer.username}`}
          value={draft}
          maxLength={MAX_BODY_LENGTH}
          onChange={(e) => {
            setDraft(e.target.value)
            if (!editing) onDraftChange(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editing) stopEditing()
          }}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={!draft.trim() || (editing !== null && (changeBusy || !online))}
          aria-label={editing ? 'Save edit' : 'Send'}
        >
          <Icon name={editing ? 'check' : 'send'} size={17} />
        </button>
      </form>
    </section>
  )
}

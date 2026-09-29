import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Conversation, Profile } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { userColor } from '../ui/colors'
import { Icon } from '../ui/Icon'
import { Scramble } from '../ui/Scramble'
import { UserSearch } from '../users/UserSearch'

/** An existing conversation, or someone to start one with. */
export type Recipient = Conversation | Profile

const MAX_CHIPS = 12

function recipientUser(to: Recipient): Profile {
  return 'peer' in to ? to.peer : to
}

type Props = {
  myId: string
  /** Most recent first; the first few become quick-pick chips. */
  conversations: Conversation[]
  onCancel: () => void
  /** Sends and opens the thread; rejects if the conversation couldn't be started. */
  onSend: (to: Recipient, body: string) => Promise<void>
}

export function ComposeScreen({ myId, conversations, onCancel, onSend }: Props) {
  const [to, setTo] = useState<Recipient | null>(conversations[0] ?? null)
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recent = conversations.slice(0, MAX_CHIPS)
  // Someone picked from search who isn't among the chips yet.
  const extra = to && !recent.some((c) => c.peer.id === recipientUser(to).id) ? to : null
  const chips: Recipient[] = extra ? [extra, ...recent] : recent
  const excludeIds = new Set([myId])
  const canSend = !!to && !!text.trim() && !sending

  async function send(e?: FormEvent) {
    e?.preventDefault()
    if (!to || !canSend) return
    setSending(true)
    setError(null)
    try {
      await onSend(to, text.trim())
    } catch {
      setError(`Couldn't start a conversation with @${recipientUser(to).username}. Try again.`)
      setSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
  }

  return (
    <section className="screen compose">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onCancel}>
          <Icon name="back" size={18} />
        </button>
        <h2 className="topbar-title">New message</h2>
        <span className="topbar-spacer" />
      </header>

      <form className="compose-body" onSubmit={send}>
        <fieldset className="recip">
          <legend className="field-label">Recipient</legend>
          {chips.length > 0 && (
            <div className="recip-chips">
              {chips.map((r) => {
                const user = recipientUser(r)
                const on = !!to && recipientUser(to).id === user.id
                const color = userColor(user.username)
                return (
                  <button
                    key={user.id}
                    type="button"
                    className={'recip-chip' + (on ? ' on' : '')}
                    aria-pressed={on}
                    style={on ? { borderColor: color, color } : undefined}
                    onClick={() => setTo(r)}
                  >
                    <Avatar username={user.username} size={20} /> {user.username}
                  </button>
                )
              })}
            </div>
          )}
          <label className="search compose-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="find someone else by username…"
              aria-label="Find someone by username"
              spellCheck={false}
            />
          </label>
          <UserSearch
            query={query}
            excludeIds={excludeIds}
            heading="Search results"
            onSelect={(user) => {
              setTo(conversations.find((c) => c.peer.id === user.id) ?? user)
              setQuery('')
            }}
          />
          <div className="recip-fp">
            <Icon name="user" size={12} />
            {to ? (
              <>
                to&nbsp;<b>@{recipientUser(to).username}</b>
                {!('peer' in to) && <span className="mono-dim">&nbsp;· new channel</span>}
              </>
            ) : (
              'pick a recipient'
            )}
          </div>
        </fieldset>

        <div className="compose-grid">
          <div className="plain-pane">
            <label className="pane-label" htmlFor="compose-text">
              <Icon name="eye" size={12} /> Message
            </label>
            <textarea
              id="compose-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="write your message…"
              maxLength={10_000}
              spellCheck={false}
              autoFocus
              disabled={sending}
            />
          </div>
          <div className="cipher-pane">
            <span className="pane-label">
              <Icon name="lock" size={12} /> Cipher preview
            </span>
            <div className="cipher-out">
              {text.trim() ? (
                <Scramble text={text} />
              ) : (
                <span className="cipher-empty">— awaiting input —</span>
              )}
            </div>
            <span className="pane-note">decorative · end-to-end encryption is coming soon</span>
          </div>
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary seal-btn" disabled={!canSend}>
          {sending ? <span className="spin" /> : <Icon name="send" size={16} />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  )
}

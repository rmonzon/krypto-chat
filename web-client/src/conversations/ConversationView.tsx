import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Conversation, Message } from '../lib/types'

type Props = {
  conversation: Conversation
  messages: Message[]
  loaded: boolean
  myId: string
  onSend: (body: string) => void
  onRetry: (message: Message) => void
}

const statusLabel = { sending: 'Sending…', sent: 'Sent', failed: 'Failed · tap to retry' }

export function ConversationView({ conversation, messages, loaded, myId, onSend, onRetry }: Props) {
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

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
        {!loaded && <li className="muted">Loading…</li>}
        {loaded && messages.length === 0 && <li className="muted">No messages yet. Say hi!</li>}
        {messages.map((m) => {
          const mine = m.sender_id === myId
          return (
            <li key={`${m.sender_id}:${m.client_msg_id}`} className={mine ? 'bubble mine' : 'bubble'}>
              <div className="body">{m.body}</div>
              {mine &&
                (m.status === 'failed' ? (
                  <button type="button" className="status failed" onClick={() => onRetry(m)}>
                    {statusLabel.failed}
                  </button>
                ) : (
                  <span className="status">{statusLabel[m.status]}</span>
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

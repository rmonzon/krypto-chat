import { useLiveQuery } from 'dexie-react-hooks'
import type { ChatDb } from '../lib/db'
import { summarizeConversations } from '../lib/summary'
import { formatListTime } from '../lib/time'
import type { Conversation } from '../lib/types'
import { Avatar } from '../ui/Avatar'

type Props = {
  db: ChatDb
  myId: string
  conversations: Conversation[]
  selectedId: string | null
  /** Filters by username / display name; empty shows everything. */
  query: string
  /** Conversations where the peer is typing right now. */
  peerTyping: ReadonlySet<string>
  onSelect: (id: string) => void
}

export function ConversationList({
  db,
  myId,
  conversations,
  selectedId,
  query,
  peerTyping,
  onSelect,
}: Props) {
  // Preview line and unread count per conversation, from the local DB.
  const summaries = useLiveQuery(
    async () =>
      summarizeConversations(await db.conversations.toArray(), await db.messages.toArray(), myId),
    [db, myId],
  )

  const q = query.trim().toLowerCase()
  const visible = q
    ? conversations.filter(
        (c) => c.peer.username.includes(q) || c.peer.display_name.toLowerCase().includes(q),
      )
    : conversations

  if (conversations.length === 0) {
    return <p className="list-note">No channels yet. Search for a username to open one.</p>
  }
  if (visible.length === 0) {
    return <p className="list-note">No channels match “{query.trim()}”.</p>
  }

  return (
    <ul className="conv-list-items">
      {visible.map((c) => {
        const summary = summaries?.get(c.id)
        const last = summary?.latest
        // Not while it's open: it's being read, and the watermark catches up in a moment.
        const unread = c.id === selectedId ? 0 : (summary?.unread ?? 0)
        const ts = c.last_message_at ?? c.created_at
        return (
          <li key={c.id}>
            <button
              type="button"
              className={
                'conv-row' + (c.id === selectedId ? ' selected' : '') + (unread ? ' unread' : '')
              }
              aria-current={c.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(c.id)}
            >
              <Avatar username={c.peer.username} size={44} />
              <div className="conv-main">
                <div className="conv-top">
                  <span className="conv-handle">{c.peer.display_name}</span>
                  <time className="conv-ts" dateTime={ts}>
                    {formatListTime(ts)}
                  </time>
                </div>
                <div className="conv-prev">
                  {peerTyping.has(c.id) ? (
                    <span className="prev-typing">typing…</span>
                  ) : last ? (
                    <>
                      {last.sender_id === myId && <span className="prev-mine">› </span>}
                      {last.deleted_at ? <span className="prev-deleted">message deleted</span> : last.body}
                    </>
                  ) : (
                    <span className="mono-dim">@{c.peer.username}</span>
                  )}
                </div>
              </div>
              {unread > 0 && (
                <span
                  className="badge"
                  aria-label={`${badgeText(unread, summary?.unreadIsLowerBound)} unread`}
                >
                  {badgeText(unread, summary?.unreadIsLowerBound)}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** "3", "3+" when older unread history isn't loaded yet, capped at "99+". */
function badgeText(count: number, lowerBound = false) {
  if (count > 99) return '99+'
  return lowerBound ? `${count}+` : String(count)
}

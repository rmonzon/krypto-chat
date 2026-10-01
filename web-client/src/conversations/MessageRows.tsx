import type { DeliveryState } from '../lib/status'
import { ttlNoticeText } from '../lib/expiry'
import { formatDayLabel, formatTime } from '../lib/time'
import type { Message } from '../lib/types'
import { Icon, type IconName } from '../ui/Icon'

// Rows of a conversation's message list (an <ol>), one <li> each.

type Status = { label: string; icon: IconName; tone?: 'pending' | 'read' | 'failed' }

const STATUS: Record<DeliveryState, Status> = {
  sending: { label: 'Sending', icon: 'clock', tone: 'pending' },
  queued: { label: 'Queued until online', icon: 'clock', tone: 'pending' },
  failed: { label: 'Failed to send · retry', icon: 'alert', tone: 'failed' },
  read: { label: 'Read', icon: 'check2', tone: 'read' },
  delivered: { label: 'Delivered', icon: 'check2' },
  sent: { label: 'Sent', icon: 'check' },
}

/** "— Today —" above the first message of each local day; day is its dayKey. */
export function DayDivider({ day, at }: { day: string; at: string }) {
  return (
    <li className="thread-day">
      <time dateTime={day}>— {formatDayLabel(at)} —</time>
    </li>
  )
}

/** "you set messages to disappear after 1 hour · 09:41" */
type NoticeRowProps = { who: string; ttlSeconds: number | null; at: string }

export function NoticeRow({ who, ttlSeconds, at }: NoticeRowProps) {
  return (
    <li className="thread-notice">
      <Icon name="timer" size={12} /> {who} {ttlNoticeText(ttlSeconds)} · {formatTime(at)}
    </li>
  )
}

export function TypingRow({ username, color }: { username: string; color: string }) {
  return (
    <li className="msg theirs typing-row" role="status">
      <span className="log-meta">
        <span className="log-ts">[{formatTime(new Date().toISOString())}]</span>
        <span className="log-who" style={{ color }}>
          &lt;{username}&gt;
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
  )
}

type MessageRowProps = {
  message: Message
  mine: boolean
  /** The sender's username, and their color (mine use the default color). */
  username: string
  color?: string
  /** My messages' delivery state; undefined for the peer's and for deleted ones. */
  delivery?: DeliveryState
  editing: boolean
  /** Whether the edit/delete actions show (mine, online, inside the edit window). */
  changeable: boolean
  confirmingDelete: boolean
  /** An edit or delete is in flight: the confirm buttons are disabled. */
  busy: boolean
  onRetry: () => void
  onEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export function MessageRow({
  message: m,
  mine,
  username,
  color,
  delivery,
  editing,
  changeable,
  confirmingDelete,
  busy,
  onRetry,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: MessageRowProps) {
  const deleted = Boolean(m.deleted_at)
  const status = delivery && STATUS[delivery]
  return (
    <li
      className={
        `msg ${mine ? 'mine' : 'theirs'}` +
        (m.status === 'sending' ? ' pending' : '') +
        (editing ? ' editing' : '')
      }
    >
      <span className="log-meta">
        <time className="log-ts" dateTime={m.created_at}>
          [{formatTime(m.created_at)}]
        </time>
        <span className="log-who" style={mine ? undefined : { color }}>
          &lt;{username}&gt;
        </span>
        {m.expires_at && (
          <span
            className="msg-expiry"
            title={`disappears ${formatDayLabel(m.expires_at).toLowerCase()} at ${formatTime(m.expires_at)}`}
            role="img"
            aria-label={`Disappears at ${formatTime(m.expires_at)}`}
          >
            <Icon name="timer" size={11} />
          </span>
        )}
      </span>
      <span className="msg-body">
        {deleted ? <span className="msg-deleted">message deleted</span> : m.body}
        {m.edited_at && !deleted && (
          <span className="msg-edited" title={`edited ${formatTime(m.edited_at)}`}>
            {' '}
            (edited)
          </span>
        )}
        {status &&
          (status.tone === 'failed' ? (
            <button type="button" className="msg-status failed" onClick={onRetry}>
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
      {changeable &&
        (confirmingDelete ? (
          <span className="msg-actions confirming" role="group" aria-label="Confirm delete">
            <span className="msg-confirm-q">delete for everyone?</span>
            <button
              type="button"
              className="msg-act danger"
              disabled={busy}
              onClick={onConfirmDelete}
            >
              yes
            </button>
            <button type="button" className="msg-act" disabled={busy} onClick={onCancelDelete}>
              no
            </button>
          </span>
        ) : (
          <span className="msg-actions">
            <button type="button" className="msg-act" aria-label="Edit message" onClick={onEdit}>
              edit
            </button>
            <button
              type="button"
              className="msg-act danger"
              aria-label="Delete message"
              onClick={onAskDelete}
            >
              del
            </button>
          </span>
        ))}
    </li>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { inviteErrorMessage } from '../lib/invites'
import type { ChatSocket } from '../lib/socket'
import type { Conversation, Invite } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'

type Props = {
  socket: Pick<ChatSocket, 'onEvent'>
  onBack: () => void
  /** A conversation was created or found through an invite (either side). */
  onAdded: (conversation: Conversation) => void
  onOpen: (conversation: Conversation) => void
}

export function AddPeerScreen({ socket, onBack, onAdded, onOpen }: Props) {
  const [joined, setJoined] = useState<Conversation | null>(null)

  function handleJoined(conversation: Conversation) {
    onAdded(conversation)
    setJoined(conversation)
  }

  return (
    <section className="screen addpeer">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          <Icon name="back" size={18} />
        </button>
        <h2 className="topbar-title">Add peer</h2>
        <span className="topbar-spacer" />
      </header>
      <div className="keys-body">
        {joined ? (
          <PeerAdded
            conversation={joined}
            onOpen={() => onOpen(joined)}
            onAgain={() => setJoined(null)}
          />
        ) : (
          <div className="ap-cols">
            <SharePanel socket={socket} onJoined={handleJoined} />
            <RedeemPanel onJoined={handleJoined} />
          </div>
        )}
      </div>
    </section>
  )
}

function SharePanel({
  socket,
  onJoined,
}: {
  socket: Props['socket']
  onJoined: (conversation: Conversation) => void
}) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Bumped by "new". Each generation requests a fresh code; the server revokes older ones.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let current = true
    api<Invite>('/invites', { method: 'POST' })
      .then((created) => {
        if (!current) return
        setFailed(false)
        setInvite(created)
        setNow(Date.now())
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [generation])

  const code = invite?.code
  useEffect(() => {
    if (!code) return
    const off = socket.onEvent((event) => {
      if (event.type === 'invite.redeemed' && event.code === code) onJoined(event.conversation)
    })
    return () => {
      off()
    }
  }, [socket, code, onJoined])

  // Tick the countdown once a second until the code expires.
  useEffect(() => {
    if (!invite) return
    const expiresAt = new Date(invite.expires_at).getTime()
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= expiresAt) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [invite])
  const secondsLeft = invite
    ? Math.max(0, Math.floor((new Date(invite.expires_at).getTime() - now) / 1000))
    : 0

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard blocked: the code is still on screen to copy by hand.
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  return (
    <section className="ap-card" aria-labelledby="share-invite">
      <h3 className="field-label" id="share-invite">
        Share an invite
      </h3>
      <p className="ap-note">
        Send this one-time code over any channel. It works once and expires in 10 minutes. Friends
        who aren’t on kryptochat yet can use it to sign up.
      </p>
      <div className={'invite-code' + (invite && !secondsLeft ? ' expired' : '')}>
        {failed ? <span className="invite-failed">couldn’t create a code</span> : (code ?? '····')}
      </div>
      <div className="invite-meta">
        <span className={secondsLeft && secondsLeft < 60 ? 'warn' : ''} aria-live="polite">
          {!invite ? '' : secondsLeft ? `expires in ${mm}:${ss}` : 'expired'}
        </span>
        <div className="kb-actions">
          <button type="button" className="ghost-btn" onClick={() => setGeneration((g) => g + 1)}>
            <Icon name="refresh" size={13} /> new
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void copy()}
            disabled={!code || !secondsLeft}
          >
            <Icon name={copied ? 'check2' : 'copy'} size={13} /> {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>
      {invite && secondsLeft > 0 && (
        <div className="ap-wait">
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          waiting for someone to redeem it
        </div>
      )}
    </section>
  )
}

function RedeemPanel({ onJoined }: { onJoined: (conversation: Conversation) => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function redeem(e: FormEvent) {
    e.preventDefault()
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const conversation = await api<Conversation>('/invites/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: value }),
      })
      onJoined(conversation)
    } catch (err) {
      setError(inviteErrorMessage(err) ?? 'Couldn’t reach the server. Try again.')
      setBusy(false)
    }
  }

  return (
    <section className="ap-card" aria-labelledby="redeem-invite">
      <h3 className="field-label" id="redeem-invite">
        Redeem an invite
      </h3>
      <p className="ap-note">Got a code from someone? Enter it to open a channel with them.</p>
      <form onSubmit={redeem} className={'ap-redeem' + (error ? ' bad' : '')}>
        <div className="key-input lg">
          <Icon name="ticket" size={16} className="ki-lead" />
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder="KC-XXXX-XXXX-XXXX"
            aria-label="Invite code"
            aria-invalid={!!error}
            aria-describedby={error ? 'redeem-error' : undefined}
            maxLength={40}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        {error && (
          <p className="form-error" id="redeem-error" role="alert">
            {error}
          </p>
        )}
        <div className="ap-row">
          <span />
          <button className="btn-primary" type="submit" disabled={!value.trim() || busy}>
            {busy ? <span className="spin" /> : <Icon name="key" size={14} />} redeem
          </button>
        </div>
      </form>
    </section>
  )
}

function PeerAdded({
  conversation,
  onOpen,
  onAgain,
}: {
  conversation: Conversation
  onOpen: () => void
  onAgain: () => void
}) {
  const { peer } = conversation
  return (
    <div className="ap-stage">
      <div className="ap-hs done" role="status">
        <Avatar username={peer.username} size={56} />
        <span className="ap-handle">{peer.display_name}</span>
        <span className="tr-fp">@{peer.username}</span>
        <span className="id-tag">
          <span className="dot live" /> peer added via invite
        </span>
        <div className="ap-actions">
          <button type="button" className="btn-primary" onClick={onOpen}>
            <Icon name="send" size={14} /> open channel
          </button>
          <button type="button" className="ghost-btn" onClick={onAgain}>
            <Icon name="userPlus" size={13} /> add another
          </button>
        </div>
      </div>
    </div>
  )
}

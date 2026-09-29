import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Conversation, Profile } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'
import { Identicon } from '../ui/Identicon'

type Props = {
  profile: Profile
  conversations: Conversation[]
  /** Messages that signing out would delete (not yet accepted by the server). */
  unsentCount: number
  onBack: () => void
  onAddPeer: () => void
  onOpen: (conversationId: string) => void
  onSignOut: () => void
}

export function IdentityScreen({
  profile,
  conversations,
  unsentCount,
  onBack,
  onAddPeer,
  onOpen,
  onSignOut,
}: Props) {
  const [email, setEmail] = useState<string | null>(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  useEffect(() => {
    let current = true
    void supabase.auth.getSession().then(({ data }) => {
      if (current) setEmail(data.session?.user.email ?? null)
    })
    return () => {
      current = false
    }
  }, [])

  const peers = [...conversations].sort((a, b) => a.peer.username.localeCompare(b.peer.username))

  return (
    <section className="screen identity">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onBack}>
          <Icon name="back" size={18} />
        </button>
        <h2 className="topbar-title">Identity</h2>
        <span className="topbar-spacer" />
      </header>

      <div className="keys-body">
        <div className="id-card">
          <Identicon seed={profile.id} />
          <div className="id-right">
            <span className="id-handle">{profile.display_name}</span>
            <span className="id-user">@{profile.username}</span>
            <span className="id-tag">
              <span className="dot live" /> signed in
            </span>
            {email && (
              <div className="id-fp">
                <span className="lbl">Account email</span>
                <span className="fp-val">{email}</span>
              </div>
            )}
          </div>
        </div>

        <section className="trusted" aria-labelledby="peers-heading">
          <div className="trusted-head">
            <h3 id="peers-heading">Peers · {peers.length}</h3>
            <button type="button" className="ghost-btn" onClick={onAddPeer}>
              <Icon name="userPlus" size={13} /> add peer
            </button>
          </div>
          {peers.length === 0 ? (
            <p className="list-note">No peers yet. Share an invite code or search for a username.</p>
          ) : (
            <ul className="trusted-list">
              {peers.map((c) => (
                <li className="trusted-row" key={c.id}>
                  <Avatar username={c.peer.username} size={32} />
                  <div className="tr-main">
                    <span className="tr-handle">{c.peer.display_name}</span>
                    <span className="tr-fp">@{c.peer.username}</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => onOpen(c.id)}
                    aria-label={`Message @${c.peer.username}`}
                  >
                    <Icon name="send" size={13} /> message
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="session-card" aria-labelledby="session-heading">
          <h3 className="field-label" id="session-heading">
            Session
          </h3>
          {confirmingSignOut ? (
            <div className="confirm-panel" role="alertdialog" aria-label="Confirm sign out">
              <p>
                <Icon name="alert" size={14} />
                {unsentCount === 1 ? '1 message hasn’t' : `${unsentCount} messages haven’t`} been
                sent yet. Signing out deletes them from this device.
              </p>
              <div className="confirm-actions">
                <button type="button" className="ghost-btn danger" onClick={onSignOut}>
                  sign out anyway
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setConfirmingSignOut(false)}
                >
                  cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="session-row">
              <p className="ap-note">Signing out deletes this device’s copy of your messages.</p>
              <button
                type="button"
                className="ghost-btn danger"
                onClick={() => (unsentCount > 0 ? setConfirmingSignOut(true) : onSignOut())}
              >
                <Icon name="logout" size={13} /> sign out
              </button>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

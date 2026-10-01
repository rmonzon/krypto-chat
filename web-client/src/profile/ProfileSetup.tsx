import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { inviteErrorMessage } from '../lib/invites'
import type { Profile } from '../lib/types'
import { Icon } from '../ui/Icon'
import { LockScreen } from '../ui/LockScreen'
import { ProfileFields } from './ProfileFields'

type Props = {
  /** Details saved at sign-up, and why creating the profile from them failed. */
  initial?: { inviteCode?: string; username?: string; displayName?: string; error?: string | null }
  onCreated: (profile: Profile) => void
}

/**
 * Fallback profile setup: normally the profile is created from the sign-up
 * form's details. This shows when that failed (e.g. the username was taken in
 * the meantime) or for accounts made before sign-up collected them.
 */
export function ProfileSetup({ initial = {}, onCreated }: Props) {
  const [inviteCode, setInviteCode] = useState(initial.inviteCode ?? '')
  const [username, setUsername] = useState(initial.username ?? '')
  const [displayName, setDisplayName] = useState(initial.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initial.error ?? null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const profile = await api<Profile>('/profiles', {
        method: 'POST',
        body: JSON.stringify({
          username,
          display_name: displayName.trim(),
          invite_code: inviteCode,
        }),
      })
      onCreated(profile)
    } catch (err) {
      setError(inviteErrorMessage(err) ?? 'Could not create your profile. Try again.')
      setBusy(false)
    }
  }

  return (
    <LockScreen
      icon="user"
      iconSize={28}
      rainOpacity={0.3}
      status={error ? <span className="err">✕ {error}</span> : <span>Choose your handle</span>}
    >
      <form className={'lock-form ' + (error ? 'bad' : '')} onSubmit={handleSubmit}>
        <label className="field-label" htmlFor="setup-invite">
          Invite code
        </label>
        <div className="key-input">
          <Icon name="ticket" size={16} className="ki-lead" />
          <input
            id="setup-invite"
            className="invite-input"
            placeholder="KC-XXXX-XXXX-XXXX"
            required
            maxLength={40}
            spellCheck={false}
            autoComplete="off"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
        </div>

        <ProfileFields
          idPrefix="setup"
          username={username}
          displayName={displayName}
          onUsernameChange={setUsername}
          onDisplayNameChange={setDisplayName}
          autoFocus
        />

        <button type="submit" className="btn-primary lock-go" disabled={busy}>
          {busy ? <span className="spin" /> : <Icon name="shield" size={16} />}
          Create identity
        </button>
      </form>
    </LockScreen>
  )
}

import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { Profile } from '../lib/types'
import { Brand } from '../ui/Brand'
import { Icon } from '../ui/Icon'
import { MatrixRain } from '../ui/MatrixRain'

export function ProfileSetup({ onCreated }: { onCreated: (profile: Profile) => void }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const profile = await api<Profile>('/profiles', {
        method: 'POST',
        body: JSON.stringify({ username, display_name: displayName.trim() }),
      })
      onCreated(profile)
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'username_taken'
          ? 'That username is taken.'
          : 'Could not create your profile. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="screen lock-screen">
      <MatrixRain opacity={0.3} />
      <div className="lock-vapor" />
      <div className="lock-core">
        <div className="lock-badge">
          <span className="lock-ring" />
          <Icon name="user" size={28} />
        </div>
        <Brand size={1.5} />
        <div className="lock-status" role="status" aria-live="polite">
          {error ? <span className="err">✕ {error}</span> : <span>Choose your handle</span>}
        </div>

        <form className={'lock-form ' + (error ? 'bad' : '')} onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="setup-username">
            Username
          </label>
          <div className="key-input">
            <span className="ki-lead ki-at" aria-hidden="true">
              @
            </span>
            <input
              id="setup-username"
              placeholder="lowercase, digits, _"
              required
              autoFocus
              spellCheck={false}
              autoComplete="username"
              pattern="[a-z0-9_]{3,30}"
              title="3–30 characters: lowercase letters, numbers, underscore"
              aria-describedby="setup-username-hint"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
            />
          </div>
          <span className="field-hint" id="setup-username-hint">
            3–30 characters. Others find you by this, and it can’t be changed later.
          </span>

          <label className="field-label" htmlFor="setup-display-name">
            Display name
          </label>
          <div className="key-input">
            <Icon name="user" size={16} className="ki-lead" />
            <input
              id="setup-display-name"
              placeholder="how you appear to peers"
              required
              maxLength={60}
              autoComplete="nickname"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary lock-go" disabled={busy}>
            {busy ? <span className="spin" /> : <Icon name="shield" size={16} />}
            Create identity
          </button>
        </form>
      </div>
    </div>
  )
}

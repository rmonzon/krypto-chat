import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import type { Profile } from '../lib/types'

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
    <main className="card">
      <h1>Choose a username</h1>
      <form onSubmit={handleSubmit} className="stack">
        <input
          placeholder="username"
          required
          pattern="[a-z0-9_]{3,30}"
          title="3–30 characters: lowercase letters, numbers, underscore"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
        />
        <input
          placeholder="Display name"
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Continue
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </main>
  )
}

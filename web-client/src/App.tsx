import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from './auth/AuthScreen'
import { api, ApiError } from './lib/api'
import { supabase } from './lib/supabase'
import type { Profile } from './lib/types'
import { ProfileSetup } from './profile/ProfileSetup'
import { UserSearch } from './users/UserSearch'

export default function App() {
  // undefined = still restoring the session from storage
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (!session) return <AuthScreen />
  // Keyed by user so switching accounts resets profile state.
  return <SignedIn key={session.user.id} />
}

function SignedIn() {
  // undefined = loading, null = user has no profile yet
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [error, setError] = useState(false)

  useEffect(() => {
    api<Profile>('/me')
      .then(setProfile)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setProfile(null)
        else setError(true)
      })
  }, [])

  if (error) return <main className="card error">Could not reach the server.</main>
  if (profile === undefined) return null
  if (profile === null) return <ProfileSetup onCreated={setProfile} />

  return (
    <main className="card">
      <header className="row">
        <span>
          <strong>{profile.display_name}</strong> <span className="muted">@{profile.username}</span>
        </span>
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <UserSearch />
    </main>
  )
}

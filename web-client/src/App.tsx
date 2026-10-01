import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from './auth/AuthScreen'
import { ChatHome } from './conversations/ChatHome'
import { api, ApiError } from './lib/api'
import { inviteErrorMessage } from './lib/invites'
import { deleteChatDb, getChatDb } from './lib/db'
import { supabase } from './lib/supabase'
import type { Profile } from './lib/types'
import { ProfileSetup } from './profile/ProfileSetup'
import { Icon } from './ui/Icon'

export default function App() {
  // undefined = still restoring the session from storage
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => data.subscription.unsubscribe()
  }, [])

  // After a sign-out (in this tab or another), delete that user's local data.
  // This runs after the chat UI has unmounted, so nothing is still using the DB.
  const lastUserId = useRef<string | null>(null)
  useEffect(() => {
    if (session) {
      lastUserId.current = session.user.id
    } else if (session === null && lastUserId.current) {
      void deleteChatDb(lastUserId.current)
      lastUserId.current = null
    }
  }, [session])

  return (
    <div className="app-shell">
      {session === undefined ? null : !session ? (
        <AuthScreen />
      ) : (
        // Keyed by user so switching accounts resets profile state.
        <SignedIn
          key={session.user.id}
          userId={session.user.id}
          signup={session.user.user_metadata as SignupDetails}
        />
      )}
    </div>
  )
}

/** What the sign-up form saved on the Supabase account (user metadata). */
type SignupDetails = { invite_code?: string; username?: string; display_name?: string }

function SignedIn({ userId, signup }: { userId: string; signup: SignupDetails }) {
  const db = getChatDb(userId)
  // undefined = loading, null = user has no profile yet
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [error, setError] = useState(false)
  // Why creating the profile from the sign-up details failed, shown on the setup screen.
  const [setupError, setSetupError] = useState<string | null>(null)
  // Strings, not the metadata object: Supabase hands out a new object on every token refresh.
  const { invite_code, username, display_name } = signup

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Show the cached profile right away so the app works offline.
      const cached = (await db.meta.get('profile'))?.value
      if (cancelled) return
      if (cached) setProfile(cached)
      try {
        const fresh = await api<Profile>('/me')
        if (cancelled) return
        setProfile(fresh)
        await db.meta.put({ key: 'profile', value: fresh })
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          const created = await createFromSignup()
          if (cancelled) return
          setProfile(created)
          if (created) await db.meta.put({ key: 'profile', value: created })
        } else if (!cached) setError(true)
      }
    }
    // First sign-in after sign-up: the form already collected the profile
    // details, so create it without another screen. Null means show setup.
    async function createFromSignup(): Promise<Profile | null> {
      if (!username || !display_name) return null
      try {
        return await api<Profile>('/profiles', {
          method: 'POST',
          body: JSON.stringify({ username, display_name, invite_code }),
        })
      } catch (err) {
        // Another tab (or StrictMode's second run) got there first.
        if (err instanceof ApiError && err.code === 'profile_exists') return api<Profile>('/me')
        if (!cancelled) {
          setSetupError(inviteErrorMessage(err) ?? 'Could not create your profile. Try again.')
        }
        return null
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [db, invite_code, username, display_name])

  function handleProfileCreated(created: Profile) {
    setProfile(created)
    void db.meta.put({ key: 'profile', value: created })
  }

  if (error) {
    return (
      <main className="empty-state">
        <Icon name="alert" size={40} className="es-alert" />
        <h3>Can’t reach the server</h3>
        <p>Your profile couldn’t be loaded. Check your connection and try again.</p>
        <button type="button" className="ghost-btn" onClick={() => window.location.reload()}>
          <Icon name="refresh" size={13} /> retry
        </button>
      </main>
    )
  }
  if (profile === undefined) return null
  if (profile === null) {
    return (
      <ProfileSetup
        initial={{
          inviteCode: invite_code,
          username,
          displayName: display_name,
          error: setupError,
        }}
        onCreated={handleProfileCreated}
      />
    )
  }

  return <ChatHome profile={profile} db={db} />
}

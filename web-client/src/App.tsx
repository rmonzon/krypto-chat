import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthScreen } from './auth/AuthScreen'
import { ChatHome } from './conversations/ChatHome'
import { api, ApiError } from './lib/api'
import { deleteChatDb, getChatDb } from './lib/db'
import { supabase } from './lib/supabase'
import type { Profile } from './lib/types'
import { ProfileSetup } from './profile/ProfileSetup'

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

  if (session === undefined) return null
  if (!session) return <AuthScreen />
  // Keyed by user so switching accounts resets profile state.
  return <SignedIn key={session.user.id} userId={session.user.id} />
}

function SignedIn({ userId }: { userId: string }) {
  const db = getChatDb(userId)
  // undefined = loading, null = user has no profile yet
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  const [error, setError] = useState(false)

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
        if (err instanceof ApiError && err.status === 404) setProfile(null)
        else if (!cached) setError(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [db])

  function handleProfileCreated(created: Profile) {
    setProfile(created)
    void db.meta.put({ key: 'profile', value: created })
  }

  if (error) return <main className="card error">Could not reach the server.</main>
  if (profile === undefined) return null
  if (profile === null) return <ProfileSetup onCreated={handleProfileCreated} />

  return <ChatHome profile={profile} db={db} />
}

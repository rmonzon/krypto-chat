import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Conversation, Profile } from '../lib/types'
import { UserSearch } from '../users/UserSearch'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'

export function ChatHome({ profile }: { profile: Profile }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ conversations: Conversation[] }>('/conversations')
      .then(({ conversations }) => setConversations(conversations))
      .catch(() => setError('Could not load conversations.'))
  }, [])

  async function openConversationWith(user: Profile) {
    setError(null)
    try {
      const conversation = await api<Conversation>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ peer_id: user.id }),
      })
      setConversations((prev) =>
        prev.some((c) => c.id === conversation.id) ? prev : [conversation, ...prev],
      )
      setSelectedId(conversation.id)
    } catch {
      setError(`Could not start a conversation with @${user.username}.`)
    }
  }

  const selected = conversations.find((c) => c.id === selectedId)

  return (
    <div className="chat">
      <aside className="stack">
        <header className="row">
          <span>
            <strong>{profile.display_name}</strong>{' '}
            <span className="muted">@{profile.username}</span>
          </span>
          <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </header>
        <UserSearch onSelect={openConversationWith} />
        {error && <p className="error">{error}</p>}
        <h2>Conversations</h2>
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </aside>
      <main>
        {selected ? (
          <ConversationView key={selected.id} conversation={selected} />
        ) : (
          <p className="muted">Select a conversation.</p>
        )}
      </main>
    </div>
  )
}

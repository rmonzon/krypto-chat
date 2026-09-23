import type { Conversation } from '../lib/types'

export function ConversationView({ conversation }: { conversation: Conversation }) {
  return (
    <section className="conversation">
      <header>
        <strong>{conversation.peer.display_name}</strong>{' '}
        <span className="muted">@{conversation.peer.username}</span>
      </header>
      {/* Messages and the composer arrive in step 4. */}
      <p className="muted">No messages yet.</p>
    </section>
  )
}

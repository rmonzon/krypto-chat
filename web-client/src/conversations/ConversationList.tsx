import type { Conversation } from '../lib/types'

type Props = {
  conversations: Conversation[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export function ConversationList({ conversations, selectedId, onSelect }: Props) {
  if (conversations.length === 0) {
    return <p className="muted">No conversations yet. Search for someone to start one.</p>
  }

  return (
    <ul className="results">
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={c.id === selectedId ? 'item selected' : 'item'}
            onClick={() => onSelect(c.id)}
          >
            <strong>{c.peer.display_name}</strong> <span className="muted">@{c.peer.username}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

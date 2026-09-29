import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Profile } from '../lib/types'
import { Avatar } from '../ui/Avatar'
import { Icon } from '../ui/Icon'

type Props = {
  query: string
  /** Users to leave out of the results, e.g. existing peers and yourself. */
  excludeIds: Set<string>
  heading?: string
  onSelect: (user: Profile) => void
}

/** Server-side user search for starting new conversations. Renders nothing for an empty query. */
export function UserSearch({ query, excludeIds, heading = 'New channel', onSelect }: Props) {
  const [results, setResults] = useState<Profile[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) return

    // Debounce, and ignore responses for queries that are no longer current.
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const { users } = await api<{ users: Profile[] }>(`/users?q=${encodeURIComponent(q)}`)
        if (!stale) {
          setResults(users)
          setError(false)
        }
      } catch {
        if (!stale) setError(true)
      }
    }, 250)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  if (!query.trim()) return null
  const visible = results.filter((u) => !excludeIds.has(u.id))

  return (
    <section className="user-search" aria-label={heading}>
      <h2 className="list-heading">{heading}</h2>
      {error ? (
        <p className="list-note err">Search failed.</p>
      ) : visible.length === 0 ? (
        <p className="list-note">No other users found.</p>
      ) : (
        <ul className="conv-list-items">
          {visible.map((user) => (
            <li key={user.id}>
              <button type="button" className="conv-row" onClick={() => onSelect(user)}>
                <Avatar username={user.username} size={36} />
                <div className="conv-main">
                  <span className="conv-handle">{user.display_name}</span>
                  <div className="conv-prev mono-dim">@{user.username}</div>
                </div>
                <Icon name="plus" size={15} className="row-action" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

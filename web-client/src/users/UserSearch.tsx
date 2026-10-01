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
  // The latest response and the query it answers; users is null if the search failed.
  const [result, setResult] = useState<{ query: string; users: Profile[] | null } | null>(null)
  const q = query.trim()

  useEffect(() => {
    if (!q) return

    // Debounce, and ignore responses for queries that are no longer current.
    let stale = false
    const timer = setTimeout(async () => {
      let users: Profile[] | null = null
      try {
        users = (await api<{ users: Profile[] }>(`/users?q=${encodeURIComponent(q)}`)).users
      } catch {
        // Shown as "Search failed" below.
      }
      if (!stale) setResult({ query: q, users })
    }, 250)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [q])

  if (!q) return null
  // Until the current query is answered, say so rather than showing another query's results.
  const current = result?.query === q ? result : null
  const visible = current?.users?.filter((u) => !excludeIds.has(u.id)) ?? []

  return (
    <section className="user-search" aria-label={heading}>
      <h2 className="list-heading">{heading}</h2>
      {!current ? (
        <p className="list-note">Searching…</p>
      ) : current.users === null ? (
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

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Profile } from '../lib/types'

export function UserSearch() {
  const [query, setQuery] = useState('')
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

  const q = query.trim()
  const visible = q ? results : []

  return (
    <section className="stack">
      <input
        type="search"
        placeholder="Search users by username"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error">Search failed.</p>}
      <ul className="results">
        {visible.map((user) => (
          <li key={user.id}>
            <strong>{user.display_name}</strong> <span className="muted">@{user.username}</span>
          </li>
        ))}
      </ul>
      {q && !error && visible.length === 0 && <p className="muted">No users found.</p>}
    </section>
  )
}

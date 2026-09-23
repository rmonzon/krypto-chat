import { useEffect, useState } from 'react'

type Health = { status: string; db: string }

export default function App() {
  const [health, setHealth] = useState<Health | 'unreachable' | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<Health>)
      .then(setHealth)
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1>Krypto Chat</h1>
      <p>
        API:{' '}
        {health === null
          ? 'checking…'
          : health === 'unreachable'
            ? 'unreachable'
            : `${health.status} (db: ${health.db})`}
      </p>
    </main>
  )
}

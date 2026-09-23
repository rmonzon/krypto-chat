# krypto-chat

State of the art encrypted messaging app

See [architecture.md](architecture.md) for the system design (source of truth).

## Projects

- [`web-client/`](web-client): Vite + React + TypeScript SPA
- [`api-server/`](api-server): Node/TypeScript REST + WebSocket server (Fastify, Postgres via Supabase)

## Local setup

Requires Node 22+ and pnpm, plus a Supabase project.

```sh
# API server
cd api-server
cp .env.example .env   # fill in DATABASE_URL (Supabase session pooler URL)
pnpm install
pnpm migrate
pnpm dev               # http://localhost:3000

# Web client (in another terminal)
cd web-client
pnpm install
pnpm dev               # http://localhost:5173, proxies /api and /ws to the API server
```

Supabase DB password: Kuc1RSvGmDP62t2Y

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
cp .env.example .env   # fill in DATABASE_URL (session pooler URL) and SUPABASE_URL
pnpm install
pnpm migrate
pnpm dev               # http://localhost:3000

# Web client (in another terminal)
cd web-client
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
pnpm install
pnpm dev               # http://localhost:5173, proxies /api and /ws to the API server
```

Keep credentials (database password, keys) in the `.env` files only. They're git-ignored.

## Tests
Both apps have automated tests, run with [Vitest](https://vitest.dev). Run them from each project's folder:

```sh
# API server: integration tests
cd api-server
pnpm test          # run once
pnpm test:watch    # re-run on file changes

# Web client: unit tests
cd web-client
pnpm test
pnpm test:watch
```

- **api-server** (`api-server/test/`): integration tests for REST and WebSocket (auth, profiles, search, conversations, messaging, receipts, sync). They start a throwaway **Postgres 17** via `embedded-postgres` (no Docker needed) and a local stand-in for Supabase Auth that signs test JWTs. No `.env` or network access is needed, and they never touch your Supabase project. The first run takes a few extra seconds while Postgres initializes.
- **web-client** (`web-client/src/**/*.test.ts`): unit tests for the offline outbox, receipts, sync, and cursor logic, using an in-memory IndexedDB (`fake-indexeddb`).

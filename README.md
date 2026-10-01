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

## Deploying

Not deployed yet. When it is, go through this list. The design (one API instance, same-origin routing) is described in [architecture.md](architecture.md).

**Supabase**
- [ ] Use a separate Supabase project for production, not the dev one.
- [ ] Disable its Data API. Nothing uses it, and RLS (enabled by the migrations) is only a backup.
- [ ] In Auth settings, set the Site URL and redirect URLs to the production web URL, so sign-up confirmation emails link there.

**api-server**
- [ ] Set `DATABASE_URL` to the production **session pooler** URL (not the transaction pooler on port 6543) and `SUPABASE_URL` to the production project. See `.env.example`.
- [ ] Run `pnpm migrate` against production before starting the new version.
- [ ] Build with `pnpm build`, run with `pnpm start`. `start` reads a `.env` file (`node --env-file=.env`) and won't start without one. On a host that injects environment variables, create the file or change the script.
- [ ] **If the API runs behind a reverse proxy or load balancer, set `TRUST_PROXY`** (`true`, or the proxies' IPs/CIDRs). Otherwise every client shares the proxy's IP, and with it one rate limit on the invite routes.
- [ ] Run exactly **one instance**. Open sockets and rate-limit counts live in memory; a second instance needs Redis (pub/sub for `notifyUser`, a shared rate-limit store).
- [ ] Let the first person in with an admin invite: `pnpm invite:create` with the production `DATABASE_URL`.

**web-client**
- [ ] Build with the production `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Vite bakes them in at build time.
- [ ] Serve `dist/` as a single-page app, and route the API on the same origin, like the dev proxy does. `/api/*` goes to the API server with the `/api` prefix removed, and `/ws` goes to it as a WebSocket. Serve over HTTPS: the client then uses `wss://`.

## Tests and checks
Both apps have automated tests, run with [Vitest](https://vitest.dev), and are linted with [oxlint](https://oxc.rs). Run them from each project's folder:

```sh
# API server: integration tests
cd api-server
pnpm test            # run once
pnpm test:watch      # re-run on file changes
pnpm test:coverage   # with a coverage report (coverage/index.html)
pnpm typecheck
pnpm lint

# Web client: unit tests
cd web-client
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm build           # typecheck and production build
pnpm lint
```

- **api-server** (`api-server/test/`): integration tests for the REST and WebSocket APIs: auth, profiles and user search, invites and invite-only sign-up, conversations, messaging, receipts, typing, edit/delete, auto-delete, sync, socket timeouts, and migrations. They start a throwaway **Postgres 17** via `embedded-postgres` (no Docker needed) and a local stand-in for Supabase Auth that signs test JWTs. No `.env` or network access is needed, and they never touch your Supabase project. The first run takes a few extra seconds while Postgres initializes.
- **web-client** (`web-client/src/**/*.test.ts`): unit tests for the client's `lib/` layer: the socket connection, outbox, receipts, sync and cursors, server events, history paging, edits, auto-delete, unread counts, typing, and formatting. They use an in-memory IndexedDB (`fake-indexeddb`) and placeholder Supabase settings, so no `.env` is needed. `protocol.test.ts` checks that values both apps rely on (edit window, auto-delete timers, limits) still match `api-server/src/protocol.ts`; change both sides together.

[CI](.github/workflows/ci.yml) runs the typecheck, lint, tests (with coverage) and, for the web client, the production build on every pull request and push to `main`.

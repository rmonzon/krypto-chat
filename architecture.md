# Krypto Chat: Architecture

> Source of truth for system design. Update this file in place when the design changes.

## Scope (v1)
- Search for registered users
- Create a 1:1 conversation with a user
- Send and receive messages in real time
- Send messages while offline
- Message delivery states: `sending`, `sent`, `delivered`, `read`, `failed`
- Sync messages on reconnect

End-to-end encryption (E2EE) is on the roadmap, so the protocol treats message bodies as opaque data from day one.

## Repository layout
Separate projects, not a monorepo:
```
krypto-chat/
├── architecture.md   # this file
├── web-client/       # React SPA
└── api-server/       # Node/TS REST + WebSocket server + SQL migrations
```

## Components
```
                 +---- sign up / sign in (supabase-js) ----> [Supabase Auth]
                 |
[web-client (React SPA)] --REST + JWT (search, conversations, sync)--> [api-server] --> [Supabase Postgres]
        |  ^                                                              |
        |  +------------- WebSocket + JWT (real-time) --------------------+
   IndexedDB (Dexie): outbox + message cache + sync cursors
```

### web-client
- A Vite + React + TypeScript SPA. It uses `supabase-js` for auth only, and talks to `api-server` for everything else.
- IndexedDB (via Dexie) holds the outbox, the cached messages, and the last seen `seq` per conversation.
- A connection manager reconnects with backoff and runs sync after each reconnect.

### api-server
- Fastify, with `@fastify/websocket` for real-time traffic. The DB is accessed with plain `pg` and raw SQL, and the schema is managed with numbered `.sql` migrations and a small runner script.
- One Node/TypeScript process that serves both the REST API and the WebSocket endpoint. Sending a message is a single in-process flow: write to the DB → ack the sender → push to the recipient. That way no message bus is needed between separate services.
- The WebSocket code lives in its own module (`src/realtime/`), and the rest of the app reaches it only through `notifyUser(userId, event)`. It keeps an in-memory map of userId → sockets. Once we run more than one instance, we add Redis pub/sub behind `notifyUser` (and extract the module into its own service if that's still worth it).
- It checks the Supabase JWT (JWKS or the project secret) on every REST request and on the WebSocket handshake, and takes the user ID from `sub`. It never handles passwords.

### Supabase
- **Auth** handles sign-up, sign-in, password hashing, sessions and token refresh. To switch providers later, only JWT verification and the sign-in UI need to change.
- **Postgres** is used as a plain managed database. `api-server` is the only thing that connects to it, through the session pooler. Avoid the transaction pooler (port 6543), which breaks prepared statements in most Node drivers.
- **Realtime is not used.** Our WebSocket is the only real-time channel.
- **Data API disabled:** nothing uses it (auth works without it), and turning it off keeps the public anon key from reaching chat data. As a backup layer, RLS is also enabled on every app table with no policies. `api-server` connects as the DB owner, which bypasses RLS.

### Local development
- A Supabase **dev project** provides both the database and auth. Production gets its own Supabase project, and the same SQL migrations run against both.
- Connect through the **session pooler** URL (IPv4, supports prepared statements). The direct connection is IPv6-only by default.
- The Vite dev server proxies `/api/*` (prefix stripped) and `/ws` to api-server, so the client uses same-origin paths and needs no CORS.

## Data model
- `profiles(id → auth.users.id, username UNIQUE, display_name, created_at)`
- `conversations(id, direct_key UNIQUE, created_at, last_seq)`: `direct_key` is the two member IDs, sorted and joined, so a 1:1 conversation can't be created twice
- `conversation_members(conversation_id, user_id, delivered_up_to_seq, read_up_to_seq)`
- `messages(id, conversation_id, seq, sender_id, client_msg_id, content_type, body, created_at)`: unique on `(conversation_id, seq)` and on `(sender_id, client_msg_id)`, which dedupes retries per sender

## Key mechanics
1. **Client-generated `client_msg_id` (UUID)**: gives an instant local render, safe retries (the server dedupes on it), and a way to match server acks to local messages.
2. **Outbox**: each send is written to IndexedDB with status `sending`. A flusher sends queued messages in order whenever the socket is up. That's how offline send works.
3. **Server `seq` per conversation**: inside one transaction, the server bumps `conversations.last_seq` and assigns the new value to the message. `seq` sets the order and serves as the sync cursor.
4. **Receipts as watermarks**: the recipient's client sends `delivered_up_to` when messages arrive and `read_up_to` when the conversation is viewed. The server stores both and forwards them to the sender.
5. **Status derivation (client side)**:
   | Status | Condition |
   |---|---|
   | `sending` | In the outbox, no server ack yet |
   | `sent` | The server acked and returned `seq` |
   | `delivered` | `seq` ≤ the peer's `delivered_up_to_seq` |
   | `read` | `seq` ≤ the peer's `read_up_to_seq` |
   | `failed` | The server rejected it (validation/auth) or retries ran out. The user can tap to retry. |
6. **Reconnect sync**: after the socket reconnects, (a) flush the outbox, then (b) call `GET /sync` with the client's cursors. The response holds the messages with `seq > cursor` and the current watermarks for each conversation.
7. **E2EE-ready**: `body` is an opaque payload tagged with `content_type` (and a version). The server never parses it, so we can switch to ciphertext later without schema changes.

## API (draft)
### REST
Every request sends `Authorization: Bearer <supabase JWT>`. Sign-up and sign-in go straight to Supabase Auth.
- `POST /profiles {username, display_name}`: create the caller's profile after sign-up
- `GET /users?q=`: search profiles by username prefix
- `POST /conversations {peer_id}`: returns the existing 1:1 conversation if there is one
- `GET /conversations`
- `GET /sync?cursors=...`

### WebSocket events
The server checks the JWT during the handshake and closes the socket if the token is invalid or expired.
- Client → server:
  - `message.send {client_msg_id, conversation_id, content_type, body}`
  - `receipt.delivered {conversation_id, seq}`
  - `receipt.read {conversation_id, seq}`
- Server → client:
  - `message.ack {client_msg_id, seq, created_at}`
  - `message.new {conversation_id, seq, sender_id, client_msg_id, content_type, body, created_at}`
  - `receipt.update {conversation_id, user_id, delivered_up_to, read_up_to}`
  - `error {client_msg_id?, reason}`

## Build order
1. `api-server` skeleton + migrations; `web-client` skeleton; Supabase dev project
2. Auth (Supabase sign-up/sign-in, JWT middleware, profiles) + user search
3. Create/list conversations
4. Real-time send/receive over WebSocket (online only)
5. Outbox + offline send (`sending` / `sent` / `failed`)
6. Delivered/read watermarks
7. Reconnect sync

## Verification checklist
- Two browsers as different users: messages appear instantly, and the ticks move through sent → delivered → read.
- Turn on DevTools "Offline" and send 3 messages: they show `sending`. Go back online: they flush in order and become `sent`.
- Take the recipient offline, send messages, then reconnect: they sync the missing messages and the sender sees `delivered`.
- Kill the server mid-send and restart it: the client retries, with no duplicates thanks to `client_msg_id`.

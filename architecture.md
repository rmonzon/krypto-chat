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
- It checks the Supabase JWT against the project's JWKS (asymmetric signing keys; issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`) on every REST request and on the WebSocket handshake, and takes the user ID from `sub`. It never handles passwords.

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
- `conversations(id, direct_key UNIQUE, created_at, last_seq, last_message_at)`: `direct_key` is the two member IDs, sorted and joined, so a 1:1 conversation can't be created twice
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
Every request except `/health` sends `Authorization: Bearer <supabase JWT>`. Sign-up and sign-in go straight to Supabase Auth. JSON fields are snake_case, and errors look like `{ "error": "<code>" }`.
- `GET /me`: the caller's profile, or 404 `profile_not_found` (the client then shows profile setup)
- `POST /profiles {username, display_name}`: create the caller's profile after sign-up. `username` must match `^[a-z0-9_]{3,30}$`. Returns 409 `username_taken` or `profile_exists`
- `GET /users?q=`: search profiles by username prefix (case-insensitive, excludes the caller, max 20)
- `POST /conversations {peer_id}`: creates the 1:1 conversation (201) or returns the existing one (200). Errors: 400 `cannot_message_self`, 403 `profile_required`, 404 `user_not_found`
- `GET /conversations`: the caller's conversations, most recently active first, each as `{id, last_seq, created_at, peer: {id, username, display_name}}`
- `GET /conversations/:id/messages?before_seq=&limit=50`: message history in ascending `seq` order (the latest page by default; `before_seq` pages backwards). 404 `conversation_not_found` if the caller isn't a member
- `GET /sync?cursors=...`

### WebSocket events
Browsers can't set headers on a WebSocket, and a token in the URL would end up in logs, so the client authenticates with its first message: `auth {token}`. The server replies `ready {user_id}`, or closes the socket with code `4401` if the token is invalid or doesn't arrive within 5s. Every event is a JSON object with a `type` field. The server handles each socket's events one at a time, in order, and pings every 30s to drop dead connections.
- Client → server:
  - `auth {token}`
  - `message.send {client_msg_id, conversation_id, content_type, body}`
  - `receipt.delivered {conversation_id, seq}`
  - `receipt.read {conversation_id, seq}`
- Server → client:
  - `ready {user_id}`
  - `message.ack {client_msg_id, conversation_id, seq, created_at}`: sent to the socket that sent the message, including for retries of a message that's already stored
  - `message.new {message}`: sent to every member's other sockets. Not re-sent for a retry of an already stored message
  - `conversation.new {conversation}`: sent to the peer when a conversation is created
  - `receipt.update {conversation_id, user_id, delivered_up_to, read_up_to}`
  - `error {client_msg_id?, reason}`: reasons are `invalid_message`, `not_a_member`, `duplicate_client_msg_id` (the same ID was used in another conversation), `internal_error`, `invalid_json`, `unknown_event`

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

-- App-level user record. Credentials live in Supabase's auth.users.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);
-- Supports prefix search (username LIKE 'abc%') regardless of DB collation.
create index profiles_username_prefix_idx on profiles (username text_pattern_ops);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  -- The two member ids, sorted and joined, so a 1:1 conversation can't be created twice.
  direct_key text not null unique,
  last_seq bigint not null default 0,
  created_at timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid not null references conversations (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  delivered_up_to_seq bigint not null default 0,
  read_up_to_seq bigint not null default 0,
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on conversation_members (user_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations (id) on delete cascade,
  seq bigint not null,
  sender_id uuid not null references profiles (id),
  client_msg_id uuid not null,
  content_type text not null,
  -- Opaque payload: the server never parses it (ciphertext once E2EE lands).
  body text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  -- Dedupe retries per sender.
  unique (sender_id, client_msg_id)
);

-- Lock out Supabase's public Data API. api-server connects as the owner and bypasses RLS.
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;

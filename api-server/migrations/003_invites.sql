-- One-time codes for connecting without finding each other by username.
create table invites (
  code text primary key,
  creator_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_by uuid references profiles (id) on delete cascade,
  redeemed_at timestamptz
);
create index invites_creator_idx on invites (creator_id);

alter table invites enable row level security;

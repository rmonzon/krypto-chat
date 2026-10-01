-- Disappearing messages: when set, each new message expires this long after
-- it's sent. Either member can change it; it applies to later messages only.
alter table conversations
  add column message_ttl_seconds integer check (message_ttl_seconds > 0);

-- Stamped at send time from the conversation's setting. Reads skip expired
-- messages and a sweeper deletes them, so seqs can have gaps from here on.
alter table messages add column expires_at timestamptz;

create index messages_expires_idx on messages (expires_at) where expires_at is not null;

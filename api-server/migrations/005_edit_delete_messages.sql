-- Senders can edit or delete their messages for a short while after sending.
-- A deleted message stays as a tombstone (body cleared) so seqs stay gap-free.
alter table messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz,
  -- Which change (see conversations.last_change_seq) last touched this message.
  add column change_seq bigint;

-- Per-conversation counter of edits/deletes. Clients sync changes after it,
-- separately from the message seq cursor, which only covers new messages.
alter table conversations add column last_change_seq bigint not null default 0;

create index messages_changes_idx on messages (conversation_id, change_seq)
  where change_seq is not null;

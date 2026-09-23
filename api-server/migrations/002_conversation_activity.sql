-- Lets the conversation list sort by most recent activity.
alter table conversations add column last_message_at timestamptz;

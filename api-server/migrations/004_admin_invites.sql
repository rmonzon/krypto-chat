-- Invites without a creator come from the admin CLI (pnpm invite:create):
-- they let someone sign up without connecting them to anyone.
alter table invites alter column creator_id drop not null;

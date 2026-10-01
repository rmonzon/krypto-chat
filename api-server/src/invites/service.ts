import { randomInt } from "node:crypto";
import type pg from "pg";

export const INVITE_TTL_MS = 10 * 60 * 1000;

// No 0/O or 1/I, so codes survive being read aloud or retyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_CHARS = 12; // 60 bits

function formatCode(chars: string) {
  return `KC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

function makeCode() {
  let chars = "";
  for (let i = 0; i < CODE_CHARS; i++) chars += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return formatCode(chars);
}

/**
 * Canonical KC-XXXX-XXXX-XXXX form of user input, tolerating case, spaces,
 * missing dashes and the KC- prefix. Undefined if it can't be a code.
 */
export function normalizeInviteCode(input: string): string | undefined {
  let chars = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (chars.length === CODE_CHARS + 2 && chars.startsWith("KC")) chars = chars.slice(2);
  if (chars.length !== CODE_CHARS || [...chars].some((c) => !CODE_ALPHABET.includes(c))) {
    return undefined;
  }
  return formatCode(chars);
}

/**
 * A one-time invite. creatorId null makes an admin invite: it lets someone
 * sign up but connects them to no one.
 */
export async function createInvite(
  db: pg.Pool | pg.PoolClient,
  creatorId: string | null,
  ttlMs = INVITE_TTL_MS,
): Promise<{ code: string; expires_at: Date }> {
  const { rows } = await db.query<{ code: string; expires_at: Date }>(
    `insert into invites (code, creator_id, expires_at) values ($1, $2, $3)
     returning code, expires_at`,
    [makeCode(), creatorId, new Date(Date.now() + ttlMs)],
  );
  return rows[0]!;
}

export type InviteFailure = { status: number; error: string };

/** Why code can't be used right now (it doesn't exist, was used, or expired). */
export async function inviteFailure(
  db: pg.Pool | pg.PoolClient,
  code: string,
): Promise<InviteFailure> {
  const { rows } = await db.query<{ redeemed_by: string | null }>(
    "select redeemed_by from invites where code = $1",
    [code],
  );
  if (!rows[0]) return { status: 404, error: "invite_not_found" };
  if (rows[0].redeemed_by) return { status: 410, error: "invite_used" };
  return { status: 410, error: "invite_expired" };
}

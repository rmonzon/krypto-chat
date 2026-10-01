import { randomUUID } from "node:crypto";
import type pg from "pg";
import { pool, withTransaction } from "../db.js";

export type MessageDto = {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  client_msg_id: string;
  content_type: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  /** Set when the sender deleted it; body is then empty. */
  deleted_at: Date | null;
  /** The conversation change (edit/delete) that last touched it; null if never changed. */
  change_seq: number | null;
  /** When it disappears (the conversation had auto-delete on when it was sent). */
  expires_at: Date | null;
};

type MessageRow = Omit<MessageDto, "seq" | "change_seq"> & {
  seq: string;
  change_seq: string | null;
};

const messageColumns =
  "id, conversation_id, seq, sender_id, client_msg_id, content_type, body, created_at, edited_at, deleted_at, change_seq, expires_at";

// Expired messages are gone as soon as they expire; the sweeper (expiry.ts)
// deletes the rows. So seqs can have gaps: clients get covered ranges and
// has_more from the server instead of inferring them from seqs.
const live = "(expires_at is null or expires_at > now())";

function toMessage(row: MessageRow): MessageDto {
  return {
    ...row,
    seq: Number(row.seq),
    change_seq: row.change_seq === null ? null : Number(row.change_seq),
  };
}

/** How long after sending a message its sender can still edit or delete it. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Content type of the notice posted when someone changes the auto-delete
 * timer; body is {"ttl_seconds": n | null}. Clients can't send this prefix.
 */
export const SYSTEM_CONTENT_PREFIX = "application/vnd.krypto-chat.";
const TTL_NOTICE_CONTENT_TYPE = `${SYSTEM_CONTENT_PREFIX}ttl+json`;

/**
 * Appends a message with the conversation's next seq, expiring per its
 * auto-delete setting (expires: false for notices that should stay). Run
 * inside a transaction that holds the conversation row lock.
 */
async function insertMessage(
  client: pg.PoolClient,
  senderId: string,
  input: SendMessageInput,
  { expires = true } = {},
): Promise<MessageDto> {
  const { rows: seqRows } = await client.query<{ last_seq: string; message_ttl_seconds: number | null }>(
    `update conversations set last_seq = last_seq + 1, last_message_at = now()
     where id = $1 returning last_seq, message_ttl_seconds`,
    [input.conversation_id],
  );
  const { last_seq, message_ttl_seconds } = seqRows[0]!;
  const { rows } = await client.query<MessageRow>(
    `insert into messages (conversation_id, seq, sender_id, client_msg_id, content_type, body, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
     returning ${messageColumns}`,
    [
      input.conversation_id,
      last_seq,
      senderId,
      input.client_msg_id,
      input.content_type,
      input.body,
      expires ? message_ttl_seconds : null,
    ],
  );
  return toMessage(rows[0]!);
}

export type SendMessageInput = {
  client_msg_id: string;
  conversation_id: string;
  content_type: string;
  body: string;
};

type SendMessageResult =
  | { ok: true; message: MessageDto; duplicate: boolean; memberIds: string[] }
  | { ok: false; reason: "not_a_member" | "duplicate_client_msg_id" };

/**
 * Stores a message with the conversation's next seq. Idempotent per
 * (sender, client_msg_id): a retry returns the stored message with duplicate=true.
 */
export async function sendMessage(
  senderId: string,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  return withTransaction(async (client) => {
    const members = await client.query<{ user_id: string }>(
      "select user_id from conversation_members where conversation_id = $1",
      [input.conversation_id],
    );
    const memberIds = members.rows.map((r) => r.user_id);
    if (!memberIds.includes(senderId)) return { ok: false, reason: "not_a_member" };

    // Lock the conversation row: serializes sends in this conversation, which
    // keeps seq gap-free and makes the duplicate check below race-free.
    await client.query("select 1 from conversations where id = $1 for update", [
      input.conversation_id,
    ]);

    const existing = await client.query<MessageRow>(
      `select ${messageColumns} from messages where sender_id = $1 and client_msg_id = $2`,
      [senderId, input.client_msg_id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].conversation_id !== input.conversation_id) {
        return { ok: false, reason: "duplicate_client_msg_id" };
      }
      return { ok: true, message: toMessage(existing.rows[0]), duplicate: true, memberIds };
    }

    const message = await insertMessage(client, senderId, input);
    return { ok: true, message, duplicate: false, memberIds };
  });
}

/** Auto-delete timers clients can pick: 5 minutes to 30 days. */
export const TTL_OPTIONS_SECONDS = [300, 3600, 86_400, 604_800, 2_592_000];

type SetTtlResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; notice: MessageDto; memberIds: string[] }
  | { ok: false; reason: "conversation_not_found" };

/**
 * Turns auto-delete on (ttlSeconds) or off (null) for later messages, and
 * posts a notice from the user so both sides see who changed it. No-op if
 * it's already set that way.
 */
export async function setMessageTtl(
  userId: string,
  conversationId: string,
  ttlSeconds: number | null,
): Promise<SetTtlResult> {
  return withTransaction(async (client) => {
    const members = await client.query<{ user_id: string }>(
      "select user_id from conversation_members where conversation_id = $1",
      [conversationId],
    );
    const memberIds = members.rows.map((r) => r.user_id);
    if (!memberIds.includes(userId)) return { ok: false, reason: "conversation_not_found" };

    const { rows } = await client.query<{ message_ttl_seconds: number | null }>(
      "select message_ttl_seconds from conversations where id = $1 for update",
      [conversationId],
    );
    if (rows[0]!.message_ttl_seconds === ttlSeconds) return { ok: true, changed: false };

    await client.query("update conversations set message_ttl_seconds = $2 where id = $1", [
      conversationId,
      ttlSeconds,
    ]);
    const notice = await insertMessage(
      client,
      userId,
      {
        client_msg_id: randomUUID(),
        conversation_id: conversationId,
        content_type: TTL_NOTICE_CONTENT_TYPE,
        body: JSON.stringify({ ttl_seconds: ttlSeconds }),
      },
      { expires: false },
    );
    return { ok: true, changed: true, notice, memberIds };
  });
}

/** Messages with seq > afterSeq, oldest first. Caller must check membership. */
export async function messagesAfter(
  conversationId: string,
  afterSeq: number,
  limit: number,
): Promise<MessageDto[]> {
  const { rows } = await pool.query<MessageRow>(
    `select ${messageColumns} from messages
     where conversation_id = $1 and seq > $2 and ${live}
     order by seq
     limit $3`,
    [conversationId, afterSeq, limit],
  );
  return rows.map(toMessage);
}

/** The latest `limit` messages, oldest first. Caller must check membership. */
export async function latestMessages(conversationId: string, limit: number): Promise<MessageDto[]> {
  const { rows } = await pool.query<MessageRow>(
    `select ${messageColumns} from messages
     where conversation_id = $1 and ${live}
     order by seq desc
     limit $2`,
    [conversationId, limit],
  );
  return rows.map(toMessage).reverse();
}

type MessagePage = {
  messages: MessageDto[];
  /** Whether there are messages before this page. */
  has_more: boolean;
  /**
   * Latest page only: every message up to this seq is in the page or gone
   * (expired), so clients can move their sync cursor here.
   */
  up_to_seq?: number;
};

/**
 * Up to `limit` messages before `beforeSeq` (or the latest), in ascending seq
 * order. Returns undefined if the user isn't a member.
 */
export async function listMessages(
  userId: string,
  conversationId: string,
  beforeSeq: number | undefined,
  limit: number,
): Promise<MessagePage | undefined> {
  // last_seq is read first: anything sent after it is beyond up_to_seq.
  const { rows: found } = await pool.query<{ last_seq: string }>(
    `select c.last_seq from conversations c
     join conversation_members m on m.conversation_id = c.id
     where c.id = $1 and m.user_id = $2`,
    [conversationId, userId],
  );
  if (!found[0]) return undefined;

  // One extra row tells whether there's more before this page.
  const { rows } = await pool.query<MessageRow>(
    `select ${messageColumns} from messages
     where conversation_id = $1 and ($2::bigint is null or seq < $2) and ${live}
     order by seq desc
     limit $3`,
    [conversationId, beforeSeq ?? null, limit + 1],
  );
  const messages = rows.slice(0, limit).map(toMessage).reverse();
  const page: MessagePage = { messages, has_more: rows.length > limit };
  if (beforeSeq === undefined) {
    page.up_to_seq = Math.max(Number(found[0].last_seq), messages.at(-1)?.seq ?? 0);
  }
  return page;
}

type ChangeMessageResult =
  | { ok: true; message: MessageDto; memberIds: string[] }
  | {
      ok: false;
      reason: "message_not_found" | "not_your_message" | "message_deleted" | "edit_window_expired";
    };

/**
 * Edits (newBody) or deletes (null) one of the user's messages, if it's
 * still within EDIT_WINDOW_MS. Each change takes the conversation's next
 * change_seq, so clients can catch up on changes they missed.
 */
export async function changeMessage(
  userId: string,
  conversationId: string,
  seq: number,
  newBody: string | null,
): Promise<ChangeMessageResult> {
  return withTransaction(async (client) => {
    const members = await client.query<{ user_id: string }>(
      "select user_id from conversation_members where conversation_id = $1",
      [conversationId],
    );
    const memberIds = members.rows.map((r) => r.user_id);
    // Same answer for "no such message" and "not your conversation", so ids don't leak.
    if (!memberIds.includes(userId)) return { ok: false, reason: "message_not_found" };

    // Serializes changes in this conversation, keeping change_seq in commit order.
    await client.query("select 1 from conversations where id = $1 for update", [conversationId]);

    const { rows: found } = await client.query<MessageRow>(
      `select ${messageColumns} from messages where conversation_id = $1 and seq = $2`,
      [conversationId, seq],
    );
    const message = found[0];
    if (!message) return { ok: false, reason: "message_not_found" };
    if (message.sender_id !== userId) return { ok: false, reason: "not_your_message" };
    if (message.deleted_at) return { ok: false, reason: "message_deleted" };
    if (message.content_type.startsWith(SYSTEM_CONTENT_PREFIX)) {
      return { ok: false, reason: "not_your_message" };
    }
    if (message.expires_at && message.expires_at.getTime() <= Date.now()) {
      return { ok: false, reason: "message_not_found" };
    }
    if (Date.now() - message.created_at.getTime() > EDIT_WINDOW_MS) {
      return { ok: false, reason: "edit_window_expired" };
    }

    const { rows: changeRows } = await client.query<{ last_change_seq: string }>(
      `update conversations set last_change_seq = last_change_seq + 1
       where id = $1 returning last_change_seq`,
      [conversationId],
    );
    const changeSeq = changeRows[0]!.last_change_seq;
    const { rows } =
      newBody === null
        ? await client.query<MessageRow>(
            `update messages set body = '', deleted_at = now(), change_seq = $3
             where conversation_id = $1 and seq = $2
             returning ${messageColumns}`,
            [conversationId, seq, changeSeq],
          )
        : await client.query<MessageRow>(
            `update messages set body = $3, edited_at = now(), change_seq = $4
             where conversation_id = $1 and seq = $2
             returning ${messageColumns}`,
            [conversationId, seq, newBody, changeSeq],
          );
    return { ok: true, message: toMessage(rows[0]!), memberIds };
  });
}

/**
 * Edited/deleted messages whose change_seq is after afterChange, in change
 * order. Caller must check membership.
 */
export async function changesAfter(
  conversationId: string,
  afterChange: number,
  limit: number,
): Promise<MessageDto[]> {
  const { rows } = await pool.query<MessageRow>(
    `select ${messageColumns} from messages
     where conversation_id = $1 and change_seq > $2 and ${live}
     order by change_seq
     limit $3`,
    [conversationId, afterChange, limit],
  );
  return rows.map(toMessage);
}

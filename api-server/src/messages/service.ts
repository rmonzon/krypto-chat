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
};

type MessageRow = Omit<MessageDto, "seq"> & { seq: string };

const messageColumns =
  "id, conversation_id, seq, sender_id, client_msg_id, content_type, body, created_at";

function toMessage(row: MessageRow): MessageDto {
  return { ...row, seq: Number(row.seq) };
}

export type SendMessageInput = {
  client_msg_id: string;
  conversation_id: string;
  content_type: string;
  body: string;
};

export type SendMessageResult =
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

    const { rows: seqRows } = await client.query<{ last_seq: string }>(
      `update conversations set last_seq = last_seq + 1, last_message_at = now()
       where id = $1 returning last_seq`,
      [input.conversation_id],
    );
    const { rows } = await client.query<MessageRow>(
      `insert into messages (conversation_id, seq, sender_id, client_msg_id, content_type, body)
       values ($1, $2, $3, $4, $5, $6)
       returning ${messageColumns}`,
      [
        input.conversation_id,
        seqRows[0]!.last_seq,
        senderId,
        input.client_msg_id,
        input.content_type,
        input.body,
      ],
    );
    return { ok: true, message: toMessage(rows[0]!), duplicate: false, memberIds };
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
     where conversation_id = $1 and seq > $2
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
     where conversation_id = $1
     order by seq desc
     limit $2`,
    [conversationId, limit],
  );
  return rows.map(toMessage).reverse();
}

/**
 * Up to `limit` messages before `beforeSeq` (or the latest), in ascending seq
 * order. Returns undefined if the user isn't a member.
 */
export async function listMessages(
  userId: string,
  conversationId: string,
  beforeSeq: number | undefined,
  limit: number,
): Promise<MessageDto[] | undefined> {
  const member = await pool.query(
    "select 1 from conversation_members where conversation_id = $1 and user_id = $2",
    [conversationId, userId],
  );
  if (member.rowCount === 0) return undefined;

  const { rows } = await pool.query<MessageRow>(
    `select ${messageColumns} from messages
     where conversation_id = $1 and ($2::bigint is null or seq < $2)
     order by seq desc
     limit $3`,
    [conversationId, beforeSeq ?? null, limit],
  );
  return rows.map(toMessage).reverse();
}

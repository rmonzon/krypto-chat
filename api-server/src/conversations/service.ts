import { pool } from "../db.js";

export type ConversationDto = {
  id: string;
  last_seq: number;
  created_at: Date;
  last_message_at: Date | null;
  peer: { id: string; username: string; display_name: string };
  /** How far the peer has received / read, as conversation seqs. */
  peer_delivered_up_to_seq: number;
  peer_read_up_to_seq: number;
};

type ConversationRow = {
  id: string;
  last_seq: string; // bigint comes back as a string
  created_at: Date;
  last_message_at: Date | null;
  peer_id: string;
  peer_username: string;
  peer_display_name: string;
  peer_delivered_up_to_seq: string;
  peer_read_up_to_seq: string;
};

// Conversations as seen by one member: the other member is the "peer".
const selectConversations = `
  select c.id, c.last_seq, c.created_at, c.last_message_at,
         p.id as peer_id, p.username as peer_username, p.display_name as peer_display_name,
         other.delivered_up_to_seq as peer_delivered_up_to_seq,
         other.read_up_to_seq as peer_read_up_to_seq
  from conversation_members me
  join conversations c on c.id = me.conversation_id
  join conversation_members other on other.conversation_id = c.id and other.user_id <> me.user_id
  join profiles p on p.id = other.user_id
  where me.user_id = $1`;

function toConversation(row: ConversationRow): ConversationDto {
  return {
    id: row.id,
    last_seq: Number(row.last_seq),
    created_at: row.created_at,
    last_message_at: row.last_message_at,
    peer: { id: row.peer_id, username: row.peer_username, display_name: row.peer_display_name },
    peer_delivered_up_to_seq: Number(row.peer_delivered_up_to_seq),
    peer_read_up_to_seq: Number(row.peer_read_up_to_seq),
  };
}

/** The user's conversations, most recently active first. */
export async function listConversations(userId: string): Promise<ConversationDto[]> {
  const { rows } = await pool.query<ConversationRow>(
    `${selectConversations} order by coalesce(c.last_message_at, c.created_at) desc`,
    [userId],
  );
  return rows.map(toConversation);
}

/** One conversation as seen by userId, or undefined if they're not a member. */
export async function getConversationForUser(
  userId: string,
  conversationId: string,
): Promise<ConversationDto | undefined> {
  const { rows } = await pool.query<ConversationRow>(`${selectConversations} and c.id = $2`, [
    userId,
    conversationId,
  ]);
  return rows[0] && toConversation(rows[0]);
}

export type ReceiptKind = "delivered" | "read";

export type ReceiptResult = {
  memberIds: string[];
  delivered_up_to_seq: number;
  read_up_to_seq: number;
};

/**
 * Moves the user's delivered (or read) watermark forward to seq, clamped to
 * the conversation's last seq. Reading implies delivery. Returns undefined if
 * nothing changed (already past seq, or not a member), so callers only
 * broadcast real progress.
 */
export async function advanceReceipt(
  userId: string,
  conversationId: string,
  kind: ReceiptKind,
  seq: number,
): Promise<ReceiptResult | undefined> {
  const isRead = kind === "read";
  const { rows } = await pool.query<{ delivered_up_to_seq: string; read_up_to_seq: string }>(
    `with target as (
       select least($3::bigint, last_seq) as seq from conversations where id = $1
     )
     update conversation_members m
     set delivered_up_to_seq = greatest(m.delivered_up_to_seq, t.seq),
         read_up_to_seq = case when $4 then greatest(m.read_up_to_seq, t.seq) else m.read_up_to_seq end
     from target t
     where m.conversation_id = $1 and m.user_id = $2
       and (m.delivered_up_to_seq < t.seq or ($4 and m.read_up_to_seq < t.seq))
     returning m.delivered_up_to_seq, m.read_up_to_seq`,
    [conversationId, userId, seq, isRead],
  );
  if (!rows[0]) return undefined;

  const members = await pool.query<{ user_id: string }>(
    "select user_id from conversation_members where conversation_id = $1",
    [conversationId],
  );
  return {
    memberIds: members.rows.map((r) => r.user_id),
    delivered_up_to_seq: Number(rows[0].delivered_up_to_seq),
    read_up_to_seq: Number(rows[0].read_up_to_seq),
  };
}

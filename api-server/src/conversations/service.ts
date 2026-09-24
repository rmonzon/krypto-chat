import { pool } from "../db.js";

export type ConversationDto = {
  id: string;
  last_seq: number;
  created_at: Date;
  last_message_at: Date | null;
  peer: { id: string; username: string; display_name: string };
};

type ConversationRow = {
  id: string;
  last_seq: string; // bigint comes back as a string
  created_at: Date;
  last_message_at: Date | null;
  peer_id: string;
  peer_username: string;
  peer_display_name: string;
};

// Conversations as seen by one member: the other member is the "peer".
const selectConversations = `
  select c.id, c.last_seq, c.created_at, c.last_message_at,
         p.id as peer_id, p.username as peer_username, p.display_name as peer_display_name
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

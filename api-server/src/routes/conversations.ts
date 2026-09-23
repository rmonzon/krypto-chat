import type { FastifyInstance } from "fastify";
import { pool, withTransaction } from "../db.js";

type ConversationRow = {
  id: string;
  last_seq: string; // bigint comes back as a string
  created_at: Date;
  peer_id: string;
  peer_username: string;
  peer_display_name: string;
};

// Conversations as seen by one member: the other member is the "peer".
const selectConversations = `
  select c.id, c.last_seq, c.created_at,
         p.id as peer_id, p.username as peer_username, p.display_name as peer_display_name
  from conversation_members me
  join conversations c on c.id = me.conversation_id
  join conversation_members other on other.conversation_id = c.id and other.user_id <> me.user_id
  join profiles p on p.id = other.user_id
  where me.user_id = $1`;

function toConversation(row: ConversationRow) {
  return {
    id: row.id,
    last_seq: Number(row.last_seq),
    created_at: row.created_at,
    peer: { id: row.peer_id, username: row.peer_username, display_name: row.peer_display_name },
  };
}

export async function conversationRoutes(app: FastifyInstance) {
  app.get("/conversations", async (request) => {
    const { rows } = await pool.query<ConversationRow>(
      `${selectConversations} order by c.created_at desc`,
      [request.userId],
    );
    return { conversations: rows.map(toConversation) };
  });

  // Returns the existing 1:1 conversation with peer_id, or creates it.
  app.post<{ Body: { peer_id: string } }>(
    "/conversations",
    {
      schema: {
        body: {
          type: "object",
          required: ["peer_id"],
          additionalProperties: false,
          properties: { peer_id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const me = request.userId;
      const peer = request.body.peer_id;
      if (peer === me) return reply.code(400).send({ error: "cannot_message_self" });

      const { rows: found } = await pool.query<{ id: string }>(
        "select id from profiles where id = any($1)",
        [[me, peer]],
      );
      const ids = new Set(found.map((r) => r.id));
      if (!ids.has(me)) return reply.code(403).send({ error: "profile_required" });
      if (!ids.has(peer)) return reply.code(404).send({ error: "user_not_found" });

      const directKey = [me, peer].sort().join(":");
      const { id, created } = await withTransaction(async (client) => {
        // On a concurrent create, the conflict check waits for the other
        // transaction, so the fallback select below sees its committed row.
        const inserted = await client.query<{ id: string }>(
          `insert into conversations (direct_key) values ($1)
           on conflict (direct_key) do nothing
           returning id`,
          [directKey],
        );
        if (inserted.rows[0]) {
          const id = inserted.rows[0].id;
          await client.query(
            "insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)",
            [id, me, peer],
          );
          return { id, created: true };
        }
        const existing = await client.query<{ id: string }>(
          "select id from conversations where direct_key = $1",
          [directKey],
        );
        return { id: existing.rows[0]!.id, created: false };
      });

      const { rows } = await pool.query<ConversationRow>(`${selectConversations} and c.id = $2`, [
        me,
        id,
      ]);
      return reply.code(created ? 201 : 200).send(toConversation(rows[0]!));
    },
  );
}

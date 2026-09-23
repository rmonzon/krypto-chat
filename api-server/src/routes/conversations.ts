import type { FastifyInstance } from "fastify";
import { getConversationForUser, listConversations } from "../conversations/service.js";
import { pool, withTransaction } from "../db.js";
import { listMessages } from "../messages/service.js";
import { notifyUser } from "../realtime/index.js";

export async function conversationRoutes(app: FastifyInstance) {
  app.get("/conversations", async (request) => {
    return { conversations: await listConversations(request.userId) };
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

      if (created) {
        // Let the peer's open clients show the new conversation right away.
        const peerView = await getConversationForUser(peer, id);
        if (peerView) notifyUser(peer, { type: "conversation.new", conversation: peerView });
      }

      const conversation = await getConversationForUser(me, id);
      return reply.code(created ? 201 : 200).send(conversation);
    },
  );

  // Message history, oldest first. Pass before_seq to page backwards.
  app.get<{ Params: { id: string }; Querystring: { before_seq?: number; limit?: number } }>(
    "/conversations/:id/messages",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          properties: {
            before_seq: { type: "integer", minimum: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const { before_seq, limit = 50 } = request.query;
      const messages = await listMessages(request.userId, request.params.id, before_seq, limit);
      if (!messages) return reply.code(404).send({ error: "conversation_not_found" });
      return { messages };
    },
  );
}

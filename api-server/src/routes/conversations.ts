import type { FastifyInstance, FastifyReply } from "fastify";
import {
  getConversationForUser,
  getOrCreateDirectConversation,
  listConversations,
} from "../conversations/service.js";
import { pool, withTransaction } from "../db.js";
import {
  changeMessage,
  listMessages,
  setMessageTtl,
  TTL_OPTIONS_SECONDS,
} from "../messages/service.js";
import { notifyUser } from "../realtime/index.js";
import { NO_NUL_PATTERN } from "../validation.js";

const changeErrorStatus = {
  message_not_found: 404,
  not_your_message: 403,
  message_deleted: 409,
  edit_window_expired: 403,
} as const;

const messageParams = {
  type: "object",
  required: ["id", "seq"],
  properties: { id: { type: "string", format: "uuid" }, seq: { type: "integer", minimum: 1 } },
} as const;

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

      const { id, created } = await withTransaction((client) =>
        getOrCreateDirectConversation(client, me, peer),
      );

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
      const page = await listMessages(request.userId, request.params.id, before_seq, limit);
      if (!page) return reply.code(404).send({ error: "conversation_not_found" });
      return page;
    },
  );

  /** Edits (body) or deletes (null) a message, then tells every member's clients. */
  async function applyChange(
    userId: string,
    conversationId: string,
    seq: number,
    body: string | null,
    reply: FastifyReply,
  ) {
    const result = await changeMessage(userId, conversationId, seq, body);
    if (!result.ok) return reply.code(changeErrorStatus[result.reason]).send({ error: result.reason });
    for (const memberId of result.memberIds) {
      notifyUser(memberId, { type: "message.updated", message: result.message });
    }
    return { message: result.message };
  }

  // Edit one of your messages, within the edit window.
  app.patch<{ Params: { id: string; seq: number }; Body: { body: string } }>(
    "/conversations/:id/messages/:seq",
    {
      schema: {
        params: messageParams,
        body: {
          type: "object",
          required: ["body"],
          additionalProperties: false,
          properties: {
            body: { type: "string", minLength: 1, maxLength: 10_000, pattern: NO_NUL_PATTERN },
          },
        },
      },
    },
    (request, reply) =>
      applyChange(request.userId, request.params.id, request.params.seq, request.body.body, reply),
  );

  // Delete one of your messages for everyone, within the edit window. It stays as a tombstone.
  app.delete<{ Params: { id: string; seq: number } }>(
    "/conversations/:id/messages/:seq",
    { schema: { params: messageParams } },
    (request, reply) =>
      applyChange(request.userId, request.params.id, request.params.seq, null, reply),
  );

  // Turn auto-delete on or off for messages sent from now on.
  app.put<{ Params: { id: string }; Body: { ttl_seconds: number | null } }>(
    "/conversations/:id/ttl",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["ttl_seconds"],
          additionalProperties: false,
          properties: { ttl_seconds: { enum: [...TTL_OPTIONS_SECONDS, null] } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const result = await setMessageTtl(request.userId, id, request.body.ttl_seconds);
      if (!result.ok) return reply.code(404).send({ error: result.reason });

      if (result.changed) {
        for (const memberId of result.memberIds) {
          const view = await getConversationForUser(memberId, id);
          if (view) notifyUser(memberId, { type: "conversation.updated", conversation: view });
          notifyUser(memberId, { type: "message.new", message: result.notice });
        }
      }
      return getConversationForUser(request.userId, id);
    },
  );
}

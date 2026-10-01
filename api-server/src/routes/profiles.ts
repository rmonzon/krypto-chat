import type { FastifyInstance } from "fastify";
import { DatabaseError } from "pg";
import {
  getConversationForUser,
  getOrCreateDirectConversation,
} from "../conversations/service.js";
import { pool, withTransaction } from "../db.js";
import { inviteFailure, normalizeInviteCode, type InviteFailure } from "../invites/service.js";
import { notifyUser } from "../realtime/index.js";
import { NO_NUL_PATTERN, USERNAME_PATTERN } from "../validation.js";

type CreateProfileBody = { username: string; display_name: string; invite_code?: string };
type Profile = { id: string; username: string; display_name: string };

export async function profileRoutes(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    const { rows } = await pool.query(
      "select id, username, display_name from profiles where id = $1",
      [request.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "profile_not_found" });
    return rows[0];
  });

  // Sign-up is invite-only: creating the profile claims an invite, and without
  // a profile nothing else in the app works. The code comes from the body, or
  // from the invite_code the sign-up form stored in the Supabase user metadata.
  app.post<{ Body: CreateProfileBody }>(
    "/profiles",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "display_name"],
          additionalProperties: false,
          properties: {
            username: { type: "string", pattern: USERNAME_PATTERN },
            display_name: { type: "string", minLength: 1, maxLength: 60, pattern: NO_NUL_PATTERN },
            invite_code: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      const me = request.userId;
      const { username, display_name, invite_code } = request.body;

      const existing = await pool.query("select 1 from profiles where id = $1", [me]);
      if (existing.rowCount) return reply.code(409).send({ error: "profile_exists" });

      let rawCode = invite_code;
      if (rawCode === undefined) {
        const { rows } = await pool.query<{ code: string | null }>(
          "select raw_user_meta_data->>'invite_code' as code from auth.users where id = $1",
          [me],
        );
        rawCode = rows[0]?.code ?? undefined;
      }
      if (!rawCode) return reply.code(403).send({ error: "invite_required" });
      const code = normalizeInviteCode(rawCode);
      if (!code) return reply.code(400).send({ error: "invalid_code" });

      type Result = { profile: Profile; creatorId: string | null; conversationId: string | null };
      let result: Result;
      try {
        result = await withTransaction(async (client): Promise<Result> => {
          const { rows } = await client.query<Profile>(
            `insert into profiles (id, username, display_name) values ($1, $2, $3)
             returning id, username, display_name`,
            [me, username, display_name.trim()],
          );
          // A code counts if it's valid now, or was valid when this account
          // signed up (so slow email confirmation doesn't lock anyone out).
          const claimed = await client.query<{ creator_id: string | null }>(
            `update invites i set redeemed_by = u.id, redeemed_at = now()
             from auth.users u
             where i.code = $1 and u.id = $2 and i.redeemed_by is null
               and (i.expires_at > now()
                    or (u.created_at >= i.created_at and u.created_at < i.expires_at))
             returning i.creator_id`,
            [code, me],
          );
          if (!claimed.rows[0]) {
            const failure = await inviteFailure(client, code);
            // Roll back the profile: no invite, no account.
            throw new InviteRejected(failure);
          }
          const creatorId = claimed.rows[0].creator_id;
          const conversationId = creatorId
            ? (await getOrCreateDirectConversation(client, me, creatorId)).id
            : null;
          return { profile: rows[0]!, creatorId, conversationId };
        });
      } catch (err) {
        if (err instanceof InviteRejected) {
          return reply.code(err.failure.status).send({ error: err.failure.error });
        }
        if (err instanceof DatabaseError && err.code === "23505") {
          const error = err.constraint === "profiles_pkey" ? "profile_exists" : "username_taken";
          return reply.code(409).send({ error });
        }
        throw err;
      }
      // The inviter's Add peer screen shows who joined; their list gets the new conversation.
      const { creatorId, conversationId } = result;
      if (creatorId && conversationId) {
        const creatorView = await getConversationForUser(creatorId, conversationId);
        if (creatorView) {
          notifyUser(creatorId, { type: "invite.redeemed", code, conversation: creatorView });
        }
      }
      return reply.code(201).send(result.profile);
    },
  );
}

class InviteRejected extends Error {
  readonly failure: InviteFailure;

  constructor(failure: InviteFailure) {
    super(failure.error);
    this.failure = failure;
  }
}

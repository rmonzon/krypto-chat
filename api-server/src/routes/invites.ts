import type { FastifyInstance } from "fastify";
import {
  getConversationForUser,
  getOrCreateDirectConversation,
} from "../conversations/service.js";
import { pool, withTransaction } from "../db.js";
import {
  createInvite,
  inviteFailure,
  normalizeInviteCode,
  type InviteFailure,
} from "../invites/service.js";
import { USERNAME_PATTERN } from "../protocol.js";
import { notifyUser } from "../realtime/index.js";

const codeBody = {
  body: {
    type: "object",
    required: ["code"],
    additionalProperties: false,
    properties: { code: { type: "string", maxLength: 40 } },
  },
} as const;

async function hasProfile(userId: string) {
  const { rowCount } = await pool.query("select 1 from profiles where id = $1", [userId]);
  return rowCount === 1;
}

const USERNAME = new RegExp(USERNAME_PATTERN);

/**
 * No auth: lets the sign-up form check a code before creating the account,
 * and (with a usable code only, so it can't be used to probe for users)
 * whether a username is free. Nothing is reserved: the code is claimed and
 * the username taken when the new user's profile is created.
 */
export async function publicInviteRoutes(app: FastifyInstance) {
  app.post<{ Body: { code: string; username?: string } }>(
    "/invites/check",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: {
            code: { type: "string", maxLength: 40 },
            username: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      const code = normalizeInviteCode(request.body.code);
      if (!code) return reply.code(400).send({ error: "invalid_code" });
      const { rowCount } = await pool.query(
        "select 1 from invites where code = $1 and redeemed_by is null and expires_at > now()",
        [code],
      );
      if (rowCount !== 1) {
        const failure = await inviteFailure(pool, code);
        return reply.code(failure.status).send({ error: failure.error });
      }

      const { username } = request.body;
      if (username !== undefined) {
        if (!USERNAME.test(username)) return reply.code(400).send({ error: "invalid_username" });
        const taken = await pool.query("select 1 from profiles where username = $1", [username]);
        if (taken.rowCount) return reply.code(409).send({ error: "username_taken" });
      }
      return { code };
    },
  );
}

export async function inviteRoutes(app: FastifyInstance) {
  // Creates a one-time invite code. It opens a conversation with the caller
  // when an existing user redeems it, or lets a new user sign up.
  app.post("/invites", async (request, reply) => {
    if (!(await hasProfile(request.userId))) {
      return reply.code(403).send({ error: "profile_required" });
    }
    return reply.code(201).send(await createInvite(pool, request.userId));
  });

  // Redeems a code as an existing user: opens (or returns) the conversation
  // with its creator, and tells the creator's clients who joined.
  app.post<{ Body: { code: string } }>(
    "/invites/redeem",
    { schema: codeBody },
    async (request, reply) => {
      const me = request.userId;
      const code = normalizeInviteCode(request.body.code);
      if (!code) return reply.code(400).send({ error: "invalid_code" });
      if (!(await hasProfile(me))) return reply.code(403).send({ error: "profile_required" });

      type Result = InviteFailure | { creatorId: string; id: string; created: boolean };
      const result = await withTransaction(async (client): Promise<Result> => {
        // Atomic claim: of two concurrent redeems, only one gets the row.
        const claimed = await client.query<{ creator_id: string }>(
          `update invites set redeemed_by = $2, redeemed_at = now()
           where code = $1 and redeemed_by is null and expires_at > now()
             and creator_id is not null and creator_id <> $2
           returning creator_id`,
          [code, me],
        );
        const creatorId = claimed.rows[0]?.creator_id;
        if (!creatorId) {
          const { rows } = await client.query<{ creator_id: string | null }>(
            "select creator_id from invites where code = $1",
            [code],
          );
          if (rows[0] && rows[0].creator_id === me) return { status: 400, error: "own_invite" };
          if (rows[0] && rows[0].creator_id === null) {
            return { status: 400, error: "signup_only_invite" };
          }
          return inviteFailure(client, code);
        }
        const conversation = await getOrCreateDirectConversation(client, me, creatorId);
        return { creatorId, ...conversation };
      });
      if ("error" in result) return reply.code(result.status).send({ error: result.error });

      const creatorView = await getConversationForUser(result.creatorId, result.id);
      if (creatorView) {
        notifyUser(result.creatorId, { type: "invite.redeemed", code, conversation: creatorView });
      }
      const conversation = await getConversationForUser(me, result.id);
      return reply.code(result.created ? 201 : 200).send(conversation);
    },
  );
}

import { randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  getConversationForUser,
  getOrCreateDirectConversation,
} from "../conversations/service.js";
import { pool, withTransaction } from "../db.js";
import { notifyUser } from "../realtime/index.js";

export const INVITE_TTL_MS = 10 * 60 * 1000;

// No 0/O or 1/I, so codes survive being read aloud or retyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_CHARS = 12; // 60 bits

function makeCode() {
  let chars = "";
  for (let i = 0; i < CODE_CHARS; i++) chars += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return formatCode(chars);
}

function formatCode(chars: string) {
  return `KC-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
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

async function hasProfile(userId: string) {
  const { rowCount } = await pool.query("select 1 from profiles where id = $1", [userId]);
  return rowCount === 1;
}

type RedeemResult =
  | { status: number; error: string }
  | { creatorId: string; id: string; created: boolean };

export async function inviteRoutes(app: FastifyInstance) {
  // Creates a one-time invite code. Replaces the caller's previous unredeemed
  // one, so only the latest code they shared works.
  app.post("/invites", async (request, reply) => {
    if (!(await hasProfile(request.userId))) {
      return reply.code(403).send({ error: "profile_required" });
    }
    const invite = await withTransaction(async (client) => {
      await client.query("delete from invites where creator_id = $1 and redeemed_by is null", [
        request.userId,
      ]);
      const { rows } = await client.query<{ code: string; expires_at: Date }>(
        `insert into invites (code, creator_id, expires_at) values ($1, $2, $3)
         returning code, expires_at`,
        [makeCode(), request.userId, new Date(Date.now() + INVITE_TTL_MS)],
      );
      return rows[0]!;
    });
    return reply.code(201).send(invite);
  });

  // Redeems a code: opens (or returns) the conversation with its creator,
  // and tells the creator's clients who joined.
  app.post<{ Body: { code: string } }>(
    "/invites/redeem",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", maxLength: 40 } },
        },
      },
    },
    async (request, reply) => {
      const me = request.userId;
      const code = normalizeInviteCode(request.body.code);
      if (!code) return reply.code(400).send({ error: "invalid_code" });
      if (!(await hasProfile(me))) return reply.code(403).send({ error: "profile_required" });

      const result = await withTransaction(async (client): Promise<RedeemResult> => {
        // Atomic claim: of two concurrent redeems, only one gets the row.
        const claimed = await client.query<{ creator_id: string }>(
          `update invites set redeemed_by = $2, redeemed_at = now()
           where code = $1 and redeemed_by is null and expires_at > now() and creator_id <> $2
           returning creator_id`,
          [code, me],
        );
        const creatorId = claimed.rows[0]?.creator_id;
        if (!creatorId) {
          const { rows } = await client.query<{
            creator_id: string;
            redeemed_by: string | null;
            expires_at: Date;
          }>("select creator_id, redeemed_by, expires_at from invites where code = $1", [code]);
          const invite = rows[0];
          if (!invite) return { status: 404, error: "invite_not_found" };
          if (invite.creator_id === me) return { status: 400, error: "own_invite" };
          if (invite.redeemed_by) return { status: 410, error: "invite_used" };
          return { status: 410, error: "invite_expired" };
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

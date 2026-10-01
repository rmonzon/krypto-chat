import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

// Supabase signs access tokens with the project's asymmetric signing keys,
// published as a JWKS. jose caches the keys and refetches on rotation.
const issuer = `${config.supabaseUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export type VerifiedToken = {
  userId: string;
  /** When the token expires, in ms since the epoch; undefined if it has no exp claim. */
  expiresAt?: number;
};

/** Verifies a Supabase access token: who it's for (`sub`) and until when. */
export async function verifyAccessToken(token: string): Promise<VerifiedToken> {
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated" });
  if (!payload.sub) throw new Error("Token has no subject");
  return {
    userId: payload.sub,
    expiresAt: payload.exp === undefined ? undefined : payload.exp * 1000,
  };
}

/** onRequest hook: rejects the request unless it carries a valid bearer token. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return reply.code(401).send({ error: "unauthorized" });

  try {
    request.userId = (await verifyAccessToken(token)).userId;
  } catch (err) {
    request.log.info({ err }, "rejected access token");
    return reply.code(401).send({ error: "unauthorized" });
  }
}

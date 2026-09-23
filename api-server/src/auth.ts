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

/** Verifies a Supabase access token and returns the user id (`sub`). */
export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated" });
  if (!payload.sub) throw new Error("Token has no subject");
  return payload.sub;
}

/** onRequest hook: rejects the request unless it carries a valid bearer token. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return reply.code(401).send({ error: "unauthorized" });

  try {
    request.userId = await verifyAccessToken(token);
  } catch (err) {
    request.log.info({ err }, "rejected access token");
    return reply.code(401).send({ error: "unauthorized" });
  }
}

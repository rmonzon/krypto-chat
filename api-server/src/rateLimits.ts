import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";

// Counts live in memory, which fits the single server instance (see
// architecture.md); a shared store (e.g. Redis) comes with a second one.

export type RateLimit = { max: number; timeWindowMs: number };

export type RateLimits = {
  /** POST /invites/check, per client IP. The sign-up form checks a code about twice. */
  inviteCheck: RateLimit;
  /** POST /invites, per user. The Add peer screen makes one per visit, plus "new". */
  inviteCreate: RateLimit;
  /** POST /invites/redeem, per user. */
  inviteRedeem: RateLimit;
};

export const DEFAULT_RATE_LIMITS: RateLimits = {
  inviteCheck: { max: 20, timeWindowMs: 60_000 },
  inviteCreate: { max: 20, timeWindowMs: 10 * 60_000 },
  inviteRedeem: { max: 10, timeWindowMs: 60_000 },
};

/** Enables per-route limits (routes opt in with perIp / perUser); nothing is limited globally. */
export async function registerRateLimits(app: FastifyInstance) {
  await app.register(rateLimit, {
    global: false,
    // The API's error shape; Retry-After says when to try again.
    errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited" }),
  });
}

/** Route config limiting each client IP (see TRUST_PROXY in config.ts). */
export function perIp({ max, timeWindowMs }: RateLimit) {
  return { rateLimit: { max, timeWindow: timeWindowMs } };
}

/** Route config limiting each signed-in user; checked after auth has set request.userId. */
export function perUser({ max, timeWindowMs }: RateLimit) {
  return {
    rateLimit: {
      max,
      timeWindow: timeWindowMs,
      hook: "preHandler" as const,
      keyGenerator: (request: FastifyRequest) => request.userId,
    },
  };
}

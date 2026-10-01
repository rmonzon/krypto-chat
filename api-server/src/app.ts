import Fastify, { type FastifyError } from "fastify";
import { requireAuth } from "./auth.js";
import { pool } from "./db.js";
import { registerRealtime, type RealtimeOptions } from "./realtime/index.js";
import { conversationRoutes } from "./routes/conversations.js";
import { inviteRoutes, publicInviteRoutes } from "./routes/invites.js";
import { profileRoutes } from "./routes/profiles.js";
import { syncRoutes } from "./routes/sync.js";
import { userRoutes } from "./routes/users.js";

export type AppOptions = { logger?: boolean; realtime?: RealtimeOptions };

export async function buildApp({ logger = true, realtime }: AppOptions = {}) {
  const app = Fastify({ logger });

  // Unexpected failures answer in the API's { error } shape, without internals
  // such as database error messages. Validation and other 4xx errors pass through.
  app.setErrorHandler<FastifyError>((err, request, reply) => {
    if (err.statusCode !== undefined && err.statusCode < 500) return reply.send(err);
    request.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });

  app.decorateRequest("userId", "");

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("select 1");
      return { status: "ok", db: "ok" };
    } catch (err) {
      app.log.error(err, "database health check failed");
      return reply.code(503).send({ status: "degraded", db: "error" });
    }
  });

  await app.register(publicInviteRoutes);

  // Everything registered in this scope requires a valid Supabase access token.
  await app.register(async (authed) => {
    authed.addHook("onRequest", requireAuth);
    await authed.register(profileRoutes);
    await authed.register(userRoutes);
    await authed.register(conversationRoutes);
    await authed.register(inviteRoutes);
    await authed.register(syncRoutes);
  });

  await registerRealtime(app, realtime);

  return app;
}

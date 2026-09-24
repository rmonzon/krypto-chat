import Fastify from "fastify";
import { requireAuth } from "./auth.js";
import { pool } from "./db.js";
import { registerRealtime } from "./realtime/index.js";
import { conversationRoutes } from "./routes/conversations.js";
import { profileRoutes } from "./routes/profiles.js";
import { syncRoutes } from "./routes/sync.js";
import { userRoutes } from "./routes/users.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

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

  // Everything registered in this scope requires a valid Supabase access token.
  await app.register(async (authed) => {
    authed.addHook("onRequest", requireAuth);
    await authed.register(profileRoutes);
    await authed.register(userRoutes);
    await authed.register(conversationRoutes);
    await authed.register(syncRoutes);
  });

  await registerRealtime(app);

  return app;
}

import Fastify from "fastify";
import { pool } from "./db.js";
import { registerRealtime } from "./realtime/index.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("select 1");
      return { status: "ok", db: "ok" };
    } catch (err) {
      app.log.error(err, "database health check failed");
      return reply.code(503).send({ status: "degraded", db: "error" });
    }
  });

  await registerRealtime(app);

  return app;
}

import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });

import { runMigrations } from "../src/migrate.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing required env var DATABASE_URL");

await runMigrations(databaseUrl);

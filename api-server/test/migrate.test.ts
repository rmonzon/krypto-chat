import { readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { describe, expect, inject, it } from "vitest";
import { runMigrations } from "../src/migrate.js";

const { databaseUrl } = inject("testEnv");

describe("runMigrations", () => {
  it("records every migration once, and does nothing when run again", async () => {
    // Global setup already migrated this database.
    const log: string[] = [];
    await runMigrations(databaseUrl, (line) => log.push(line));
    expect(log).toEqual(["No pending migrations."]);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ name: string }>(
        "select name from schema_migrations order by name",
      );
      const files = (await readdir(path.join(import.meta.dirname, "..", "migrations")))
        .filter((f) => f.endsWith(".sql"))
        .sort();
      expect(rows.map((r) => r.name)).toEqual(files);
    } finally {
      await client.end();
    }
  });
});

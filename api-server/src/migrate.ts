// Applies migrations/*.sql in filename order, each in its own transaction,
// and records applied files in schema_migrations.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const migrationsDir = path.join(import.meta.dirname, "..", "migrations");

export async function runMigrations(connectionString: string, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
      alter table schema_migrations enable row level security;
    `);

    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) log("No pending migrations.");

    for (const file of pending) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        log(`Applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        log(`Failed on ${file}`);
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

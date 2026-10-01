import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

/** Runs fn inside a transaction on a dedicated client; rolls back if it throws. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // Set when even the rollback fails: the connection is unusable, so the pool discards it.
  let broken: Error | undefined;
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    // A failed rollback mustn't hide the error that caused it.
    await client.query("rollback").catch((rollbackErr: Error) => (broken = rollbackErr));
    throw err;
  } finally {
    client.release(broken);
  }
}

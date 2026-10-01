import type { FastifyBaseLogger } from "fastify";
import { pool } from "../db.js";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Deletes expired messages. Reads already skip them, so this only removes
 * them from storage. Returns how many were deleted.
 */
export async function sweepExpiredMessages(): Promise<number> {
  const { rowCount } = await pool.query("delete from messages where expires_at <= now()");
  return rowCount ?? 0;
}

/** Sweeps every minute until the returned stop function is called. */
export function startExpirySweeper(log: FastifyBaseLogger): () => void {
  const timer = setInterval(() => {
    sweepExpiredMessages().catch((err) => log.error({ err }, "expiry sweep failed"));
  }, SWEEP_INTERVAL_MS);
  return () => clearInterval(timer);
}

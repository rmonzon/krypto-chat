import { describe, expect, it, vi } from "vitest";
import { pool, withTransaction } from "../src/db.js";
import { useTestServer } from "./helpers.js";

useTestServer();

describe("withTransaction", () => {
  it("rolls back when fn throws", async () => {
    await pool.query("create table if not exists tx_probe (n int)");
    await pool.query("truncate tx_probe");
    await expect(
      withTransaction(async (client) => {
        await client.query("insert into tx_probe values (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await pool.query("select * from tx_probe")).rowCount).toBe(0);
    await pool.query("drop table tx_probe");
  });

  it("throws fn's error, not the rollback's, and discards the broken connection", async () => {
    const release = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === "rollback") throw new Error("connection lost");
      }),
      release,
    };
    // `as never`: spyOn types connect by its last overload, the callback form returning void.
    vi.spyOn(pool, "connect").mockResolvedValueOnce(client as never);

    await expect(
      withTransaction(async () => {
        throw new Error("the real problem");
      }),
    ).rejects.toThrow("the real problem");
    expect(release).toHaveBeenCalledWith(expect.objectContaining({ message: "connection lost" }));
  });
});

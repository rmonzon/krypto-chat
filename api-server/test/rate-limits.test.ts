import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../src/config.js";
import { baseUrl, createUser, request, useTestServer } from "./helpers.js";

const limit = { max: 2, timeWindowMs: 60_000 };
useTestServer({ rateLimits: { inviteCheck: limit, inviteCreate: limit, inviteRedeem: limit } });

const checkCode = (headers: Record<string, string> = {}) =>
  fetch(`${baseUrl()}/invites/check`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ code: "KC-AAAA-BBBB-CCCC" }),
  });

describe("rate limits", () => {
  it("limits /invites/check per client IP, and says when to retry", async () => {
    expect((await checkCode()).status).toBe(404);
    expect((await checkCode()).status).toBe(404);

    const limited = await checkCode();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ statusCode: 429, error: "rate_limited" });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // With TRUST_PROXY off, a client can't get a fresh allowance by claiming another IP.
    expect((await checkCode({ "x-forwarded-for": "203.0.113.9" })).status).toBe(429);
  });

  it("limits creating invites per user", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const create = (token: string) => request("POST", "/invites", { token });

    expect((await create(alice.token)).status).toBe(201);
    expect((await create(alice.token)).status).toBe(201);
    const limited = await create(alice.token);
    expect(limited).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect((await create(bob.token)).status).toBe(201);
  });

  it("limits redeeming per user, failed attempts included", async () => {
    const alice = await createUser("alice");
    const redeem = () =>
      request("POST", "/invites/redeem", {
        token: alice.token,
        body: { code: "KC-AAAA-BBBB-CCCC" },
      });

    expect((await redeem()).status).toBe(404);
    expect((await redeem()).status).toBe(404);
    expect((await redeem()).status).toBe(429);
  });
});

describe("parseTrustProxy", () => {
  it("is off unless set, and takes true or a list of proxy addresses", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("true")).toBe(true);
    expect(parseTrustProxy("10.0.0.1, 192.168.0.0/16")).toEqual(["10.0.0.1", "192.168.0.0/16"]);
  });
});

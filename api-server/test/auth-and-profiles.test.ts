import { describe, expect, it, vi } from "vitest";
import { pool } from "../src/db.js";
import {
  adminInvite,
  createAuthUser,
  createUser,
  request,
  signToken,
  useTestServer,
} from "./helpers.js";

useTestServer();

describe("auth", () => {
  it("serves /health without a token", async () => {
    const res = await request("GET", "/health");
    expect(res).toEqual({ status: 200, body: { status: "ok", db: "ok" } });
  });

  it("answers unexpected failures with internal_error, without internals", async () => {
    const { token } = await createAuthUser();
    vi.spyOn(pool, "query").mockRejectedValueOnce(new Error('relation "profiles" is locked'));
    expect(await request("GET", "/me", { token })).toEqual({
      status: 500,
      body: { error: "internal_error" },
    });
  });

  it("rejects missing, malformed, and mis-scoped tokens", async () => {
    const { id } = await createAuthUser();
    expect((await request("GET", "/me")).status).toBe(401);
    expect((await request("GET", "/me", { token: "garbage" })).status).toBe(401);
    const wrongAudience = await signToken(id, { audience: "anon" });
    expect((await request("GET", "/me", { token: wrongAudience })).status).toBe(401);
    const wrongIssuer = await signToken(id, { issuer: "https://evil.example/auth/v1" });
    expect((await request("GET", "/me", { token: wrongIssuer })).status).toBe(401);
    const expired = await signToken(id, { expiresIn: "-1m" });
    expect((await request("GET", "/me", { token: expired })).status).toBe(401);
  });

  it("accepts a valid token and reports a missing profile", async () => {
    const { token } = await createAuthUser();
    expect(await request("GET", "/me", { token })).toEqual({
      status: 404,
      body: { error: "profile_not_found" },
    });
  });
});

describe("profiles", () => {
  it("creates a profile and returns it from /me", async () => {
    const { id, token } = await createAuthUser();
    const created = await request("POST", "/profiles", {
      token,
      body: { username: "alice", display_name: "  Alice  ", invite_code: await adminInvite() },
    });
    expect(created).toEqual({
      status: 201,
      body: { id, username: "alice", display_name: "Alice" },
    });
    expect((await request("GET", "/me", { token })).body).toEqual(created.body);
  });

  it("rejects a taken username and a second profile", async () => {
    const alice = await createUser("alice");
    const other = await createAuthUser();
    const taken = await request("POST", "/profiles", {
      token: other.token,
      body: { username: "alice", display_name: "Other", invite_code: await adminInvite() },
    });
    expect(taken).toEqual({ status: 409, body: { error: "username_taken" } });

    const again = await request("POST", "/profiles", {
      token: alice.token,
      body: { username: "alice2", display_name: "Alice" },
    });
    expect(again).toEqual({ status: 409, body: { error: "profile_exists" } });
  });

  it("validates usernames", async () => {
    const { token } = await createAuthUser();
    for (const username of ["ab", "Alice", "has space", "a".repeat(31)]) {
      const res = await request("POST", "/profiles", {
        token,
        body: { username, display_name: "X" },
      });
      expect(res.status, username).toBe(400);
    }
  });

  it("rejects a display name with NUL characters, which Postgres can't store", async () => {
    const { token } = await createAuthUser();
    const res = await request("POST", "/profiles", {
      token,
      body: { username: "alice", display_name: "Al\u0000ice", invite_code: await adminInvite() },
    });
    expect(res).toMatchObject({ status: 400, body: { code: "FST_ERR_VALIDATION" } });
  });
});

describe("user search", () => {
  it("matches username prefixes case-insensitively and excludes the caller", async () => {
    const alice = await createUser("alice");
    await createUser("alfred");
    await createUser("bob");
    const res = await request("GET", "/users?q=AL", { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.body.users.map((u: { username: string }) => u.username)).toEqual(["alfred"]);
  });

  it("treats _ and % literally", async () => {
    const me = await createUser("searcher");
    await createUser("a_b");
    await createUser("axb");
    const underscore = await request("GET", "/users?q=a_", { token: me.token });
    expect(underscore.body.users.map((u: { username: string }) => u.username)).toEqual(["a_b"]);
    const percent = await request("GET", "/users?q=%25", { token: me.token });
    expect(percent.body.users).toEqual([]);
  });

  it("rejects a query with NUL characters", async () => {
    const me = await createUser("searcher");
    expect((await request("GET", "/users?q=a%00", { token: me.token })).status).toBe(400);
  });

  it("returns nobody for a whitespace-only query", async () => {
    const me = await createUser("searcher");
    await createUser("alice");
    const res = await request("GET", "/users?q=%20%20", { token: me.token });
    expect(res).toEqual({ status: 200, body: { users: [] } });
  });
});

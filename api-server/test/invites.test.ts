import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { normalizeInviteCode } from "../src/invites/service.js";
import {
  adminInvite,
  createAuthUser,
  createUser,
  request,
  TestSocket,
  useTestServer,
} from "./helpers.js";

useTestServer();

const CODE = /^KC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

describe("normalizeInviteCode", () => {
  it("accepts any case, spacing, and missing dashes or prefix", () => {
    expect(normalizeInviteCode("kc-7q2m-x9fa-3ldp")).toBe("KC-7Q2M-X9FA-3LDP");
    expect(normalizeInviteCode(" 7Q2M X9FA 3LDP ")).toBe("KC-7Q2M-X9FA-3LDP");
    expect(normalizeInviteCode("KC7Q2MX9FA3LDP")).toBe("KC-7Q2M-X9FA-3LDP");
  });

  it("rejects the wrong length or ambiguous characters", () => {
    expect(normalizeInviteCode("KC-7Q2M-X9FA")).toBeUndefined();
    expect(normalizeInviteCode("KC-7Q2M-X9FA-3LD0")).toBeUndefined(); // 0 isn't in the alphabet
  });
});

describe("POST /invites", () => {
  it("creates a code that expires in 10 minutes; earlier codes stay valid", async () => {
    const alice = await createUser("alice");

    const first = await request("POST", "/invites", { token: alice.token });
    expect(first.status).toBe(201);
    expect(first.body.code).toMatch(CODE);
    const ttl = new Date(first.body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);

    // An invitee may have signed up with the earlier code and not finished setup yet.
    const second = await request("POST", "/invites", { token: alice.token });
    const { rows } = await pool.query(
      "select code from invites where creator_id = $1 order by created_at",
      [alice.id],
    );
    expect(rows).toEqual([{ code: first.body.code }, { code: second.body.code }]);
  });

  it("requires a profile", async () => {
    const { token } = await createAuthUser();
    expect(await request("POST", "/invites", { token })).toEqual({
      status: 403,
      body: { error: "profile_required" },
    });
  });
});

describe("POST /invites/redeem", () => {
  it("opens a conversation with the creator and tells the creator's clients", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const aliceSocket = await TestSocket.connect(alice);
    const { body: invite } = await request("POST", "/invites", { token: alice.token });

    const res = await request("POST", "/invites/redeem", {
      token: bob.token,
      body: { code: invite.code.toLowerCase() },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ peer: { id: alice.id, username: "alice" } });
    expect(await aliceSocket.next("invite.redeemed")).toMatchObject({
      code: invite.code,
      conversation: { id: res.body.id, peer: { id: bob.id } },
    });
    aliceSocket.close();
  });

  it("returns the existing conversation when the two already talk", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const existing = await request("POST", "/conversations", {
      token: bob.token,
      body: { peer_id: alice.id },
    });
    const { body: invite } = await request("POST", "/invites", { token: alice.token });

    const res = await request("POST", "/invites/redeem", {
      token: bob.token,
      body: { code: invite.code },
    });
    expect(res).toMatchObject({ status: 200, body: { id: existing.body.id } });
  });

  it("works once: a second redeem, or a concurrent one, is rejected", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const carol = await createUser("carol");
    const { body: invite } = await request("POST", "/invites", { token: alice.token });

    const results = await Promise.all(
      [bob, carol].map((u) =>
        request("POST", "/invites/redeem", { token: u.token, body: { code: invite.code } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(results.find((r) => r.status === 410)?.body).toEqual({ error: "invite_used" });
  });

  it("rejects admin (sign-up only) codes", async () => {
    const bob = await createUser("bob");
    const res = await request("POST", "/invites/redeem", {
      token: bob.token,
      body: { code: await adminInvite() },
    });
    expect(res).toEqual({ status: 400, body: { error: "signup_only_invite" } });
  });

  it("rejects expired, unknown, malformed, and own codes", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const { body: invite } = await request("POST", "/invites", { token: alice.token });
    const redeem = (token: string, code: string) =>
      request("POST", "/invites/redeem", { token, body: { code } });

    expect(await redeem(alice.token, invite.code)).toEqual({
      status: 400,
      body: { error: "own_invite" },
    });
    expect(await redeem(bob.token, "KC-AAAA-BBBB-CCCC")).toEqual({
      status: 404,
      body: { error: "invite_not_found" },
    });
    expect(await redeem(bob.token, "hello")).toEqual({
      status: 400,
      body: { error: "invalid_code" },
    });

    await pool.query("update invites set expires_at = now() - interval '1 second'");
    expect(await redeem(bob.token, invite.code)).toEqual({
      status: 410,
      body: { error: "invite_expired" },
    });
  });
});

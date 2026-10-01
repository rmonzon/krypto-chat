import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import {
  adminInvite,
  createAuthUser,
  createUser,
  request,
  TestSocket,
  useTestServer,
} from "./helpers.js";

useTestServer();

const MINUTE = 60_000;
const profile = { username: "newbie", display_name: "Newbie" };

async function hasProfile(id: string) {
  const { rowCount } = await pool.query("select 1 from profiles where id = $1", [id]);
  return rowCount === 1;
}

/** Moves an invite's lifetime into the past. */
async function backdateInvite(code: string, createdMinsAgo: number, expiredMinsAgo: number) {
  await pool.query(
    `update invites set created_at = now() - make_interval(mins => $2),
                        expires_at = now() - make_interval(mins => $3)
     where code = $1`,
    [code, createdMinsAgo, expiredMinsAgo],
  );
}

describe("invite-only sign-up", () => {
  it("won't create a profile without an invite", async () => {
    const { id, token } = await createAuthUser();
    const res = await request("POST", "/profiles", { token, body: profile });
    expect(res).toEqual({ status: 403, body: { error: "invite_required" } });
    expect(await hasProfile(id)).toBe(false);
  });

  it("uses the code saved at sign-up, connects the pair, and tells the inviter", async () => {
    const alice = await createUser("alice");
    const aliceSocket = await TestSocket.connect(alice);
    const { body: invite } = await request("POST", "/invites", { token: alice.token });
    const newbie = await createAuthUser({ metadata: { invite_code: invite.code } });

    const res = await request("POST", "/profiles", { token: newbie.token, body: profile });

    expect(res).toMatchObject({ status: 201, body: { id: newbie.id, username: "newbie" } });
    const joined = await aliceSocket.next("invite.redeemed");
    expect(joined).toMatchObject({ code: invite.code, conversation: { peer: { id: newbie.id } } });
    const list = await request("GET", "/conversations", { token: newbie.token });
    expect(list.body.conversations).toMatchObject([{ peer: { id: alice.id } }]);
    aliceSocket.close();
  });

  it("prefers a code in the body, and admin codes connect to no one", async () => {
    const newbie = await createAuthUser({ metadata: { invite_code: "KC-AAAA-BBBB-CCCC" } });
    const res = await request("POST", "/profiles", {
      token: newbie.token,
      body: { ...profile, invite_code: (await adminInvite()).toLowerCase() },
    });
    expect(res.status).toBe(201);
    const list = await request("GET", "/conversations", { token: newbie.token });
    expect(list.body.conversations).toEqual([]);
  });

  it("rejects used, unknown and malformed codes, and keeps no profile", async () => {
    const code = await adminInvite();
    const first = await createAuthUser();
    const firstRes = await request("POST", "/profiles", {
      token: first.token,
      body: { ...profile, invite_code: code },
    });
    expect(firstRes.status).toBe(201);

    const second = await createAuthUser();
    const redeem = (invite_code: string) =>
      request("POST", "/profiles", {
        token: second.token,
        body: { username: "second", display_name: "Second", invite_code },
      });
    expect(await redeem(code)).toEqual({ status: 410, body: { error: "invite_used" } });
    expect(await redeem("KC-AAAA-BBBB-CCCC")).toEqual({
      status: 404,
      body: { error: "invite_not_found" },
    });
    expect(await redeem("nope")).toEqual({ status: 400, body: { error: "invalid_code" } });
    expect(await hasProfile(second.id)).toBe(false);
  });

  it("accepts a code that expired after sign-up, but not one already expired", async () => {
    // Invite lived from 30 to 20 minutes ago.
    const code = await adminInvite();
    await backdateInvite(code, 30, 20);

    const signedUpInTime = await createAuthUser({
      metadata: { invite_code: code },
      createdAt: new Date(Date.now() - 25 * MINUTE),
    });
    const signedUpLate = await createAuthUser({
      metadata: { invite_code: code },
      createdAt: new Date(Date.now() - 15 * MINUTE),
    });

    expect(
      await request("POST", "/profiles", {
        token: signedUpLate.token,
        body: { username: "late", display_name: "Late" },
      }),
    ).toEqual({ status: 410, body: { error: "invite_expired" } });
    expect(
      (await request("POST", "/profiles", { token: signedUpInTime.token, body: profile })).status,
    ).toBe(201);
  });

  it("won't accept an expired code for an account created before the code existed", async () => {
    const code = await adminInvite();
    await backdateInvite(code, 30, 20);
    const old = await createAuthUser({ createdAt: new Date(Date.now() - 60 * MINUTE) });

    const res = await request("POST", "/profiles", {
      token: old.token,
      body: { ...profile, invite_code: code },
    });
    expect(res).toEqual({ status: 410, body: { error: "invite_expired" } });
  });
});

describe("POST /invites/check", () => {
  it("needs no token and returns the normalized code when it's usable", async () => {
    const code = await adminInvite();
    expect(
      await request("POST", "/invites/check", { body: { code: code.toLowerCase() } }),
    ).toEqual({ status: 200, body: { code } });
  });

  it("explains why a code can't be used", async () => {
    const check = (code: string) => request("POST", "/invites/check", { body: { code } });
    expect(await check("hello")).toEqual({ status: 400, body: { error: "invalid_code" } });
    expect(await check("KC-AAAA-BBBB-CCCC")).toEqual({
      status: 404,
      body: { error: "invite_not_found" },
    });

    const expired = await adminInvite();
    await backdateInvite(expired, 30, 20);
    expect(await check(expired)).toEqual({ status: 410, body: { error: "invite_expired" } });
  });
  it("checks a username too, but only alongside a usable code", async () => {
    await createUser("alice");
    const code = await adminInvite();
    const check = (body: object) => request("POST", "/invites/check", { body });

    expect(await check({ code, username: "newbie" })).toEqual({ status: 200, body: { code } });
    expect(await check({ code, username: "alice" })).toEqual({
      status: 409,
      body: { error: "username_taken" },
    });
    expect(await check({ code, username: "Bad Name" })).toEqual({
      status: 400,
      body: { error: "invalid_username" },
    });
    // No usable code: the username isn't looked at.
    expect(await check({ code: "KC-AAAA-BBBB-CCCC", username: "alice" })).toEqual({
      status: 404,
      body: { error: "invite_not_found" },
    });
  });
});

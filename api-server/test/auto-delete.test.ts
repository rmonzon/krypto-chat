import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { sweepExpiredMessages } from "../src/messages/expiry.js";
import {
  createConversation,
  createUser,
  request,
  sendText,
  TestSocket,
  useTestServer,
} from "./helpers.js";

useTestServer();

/** Makes these messages expired as of now (the sweeper hasn't run yet). */
async function expire(...seqs: number[]) {
  await pool.query(
    "update messages set expires_at = now() - interval '1 second' where seq = any($1)",
    [seqs],
  );
}

async function setup() {
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const conversationId = await createConversation(alice, bob);
  const aliceSocket = await TestSocket.connect(alice);
  const bobSocket = await TestSocket.connect(bob);
  const ttlPath = `/conversations/${conversationId}/ttl`;
  return { alice, bob, conversationId, aliceSocket, bobSocket, ttlPath };
}

describe("PUT /conversations/:id/ttl", () => {
  it("sets the timer, posts a notice, and tells both members", async () => {
    const { alice, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();

    const res = await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 3600 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: conversationId, message_ttl_seconds: 3600, last_seq: 1 });

    for (const socket of [aliceSocket, bobSocket]) {
      const updated = await socket.next("conversation.updated");
      expect(updated.conversation).toMatchObject({ id: conversationId, message_ttl_seconds: 3600 });
      const { message } = await socket.next("message.new");
      expect(message).toMatchObject({
        seq: 1,
        sender_id: alice.id,
        content_type: "application/vnd.krypto-chat.ttl+json",
        expires_at: null, // the notice itself stays
      });
      expect(JSON.parse(message.body)).toEqual({ ttl_seconds: 3600 });
    }

    // Setting the same value again changes nothing.
    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 3600 } });
    await bobSocket.expectNone("message.new");
    const list = await request("GET", "/conversations", { token: alice.token });
    expect(list.body.conversations[0].last_seq).toBe(1);
    aliceSocket.close();
    bobSocket.close();
  });

  it("rejects timers outside the options, and non-members", async () => {
    const { alice, aliceSocket, bobSocket, ttlPath } = await setup();
    const eve = await createUser("eve");

    expect((await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 123 } })).status).toBe(400);
    expect(await request("PUT", ttlPath, { token: eve.token, body: { ttl_seconds: 300 } })).toMatchObject({
      status: 404,
      body: { error: "conversation_not_found" },
    });
    aliceSocket.close();
    bobSocket.close();
  });
});

describe("expiring messages", () => {
  it("stamps expires_at on messages sent while the timer is on", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();
    await request("PUT", ttlPath, { token: bob.token, body: { ttl_seconds: 300 } });

    const ack = await sendText(aliceSocket, conversationId, "secret");
    const lifetime = Date.parse(ack.expires_at) - Date.parse(ack.created_at);
    expect(lifetime).toBeGreaterThanOrEqual(299_000);
    expect(lifetime).toBeLessThanOrEqual(301_000);

    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: null } });
    expect((await sendText(aliceSocket, conversationId, "kept")).expires_at).toBeNull();
    aliceSocket.close();
    bobSocket.close();
  });

  it("drops expired messages from reads right away, and the sweeper deletes them", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();
    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 300 } });
    const ack = await sendText(aliceSocket, conversationId, "secret");
    await expire(ack.seq);

    const history = await request("GET", `/conversations/${conversationId}/messages`, {
      token: bob.token,
    });
    // Only the notice is left, and the page still covers seq 2.
    expect(history.body).toMatchObject({ has_more: false, up_to_seq: 2 });
    expect(history.body.messages.map((m: any) => m.seq)).toEqual([1]);
    expect(
      await request("PATCH", `/conversations/${conversationId}/messages/2`, {
        token: alice.token,
        body: { body: "x" },
      }),
    ).toMatchObject({ status: 404, body: { error: "message_not_found" } });

    expect(await sweepExpiredMessages()).toBe(1);
    expect((await pool.query("select seq from messages")).rows).toEqual([{ seq: "1" }]);
    expect(await sweepExpiredMessages()).toBe(0);
    aliceSocket.close();
    bobSocket.close();
  });

  it("pages history across gaps, with has_more from the server", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();
    // Seq 1-3 kept, timer on (notice is seq 4), 5-7 expire, 8 is live.
    for (const body of ["a", "b", "c"]) await sendText(aliceSocket, conversationId, body);
    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 300 } });
    for (const body of ["d", "e", "f", "g"]) await sendText(aliceSocket, conversationId, body);
    await expire(5, 6, 7);
    const path = `/conversations/${conversationId}/messages`;

    const latest = await request("GET", `${path}?limit=2`, { token: bob.token });
    expect(latest.body.messages.map((m: any) => m.seq)).toEqual([4, 8]);
    expect(latest.body).toMatchObject({ has_more: true, up_to_seq: 8 });

    const older = await request("GET", `${path}?limit=2&before_seq=4`, { token: bob.token });
    expect(older.body.messages.map((m: any) => m.seq)).toEqual([2, 3]);
    expect(older.body.has_more).toBe(true);
    expect(older.body.up_to_seq).toBeUndefined();

    const oldest = await request("GET", `${path}?limit=2&before_seq=2`, { token: bob.token });
    expect(oldest.body).toMatchObject({ has_more: false });
    expect(oldest.body.messages.map((m: any) => m.seq)).toEqual([1]);
    aliceSocket.close();
    bobSocket.close();
  });

  it("moves sync cursors past expired messages", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();
    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 300 } });
    for (const body of ["a", "b", "c"]) await sendText(aliceSocket, conversationId, body);
    await expire(2, 3);

    // Bob had up to the notice (seq 1); 2-3 expired while he was away.
    const res = await request("POST", "/sync", {
      token: bob.token,
      body: { cursors: { [conversationId]: 1 } },
    });
    expect(res.body.messages.map((m: any) => m.seq)).toEqual([4]);
    expect(res.body.synced_up_to).toEqual({ [conversationId]: 4 });

    await expire(4);
    const fresh = await request("POST", "/sync", { token: bob.token, body: { cursors: {} } });
    expect(fresh.body.messages.map((m: any) => m.seq)).toEqual([1]);
    expect(fresh.body.synced_up_to).toEqual({ [conversationId]: 4 });
    aliceSocket.close();
    bobSocket.close();
  });

  it("refuses notices sent by clients, and edits of notices", async () => {
    const { alice, conversationId, aliceSocket, bobSocket, ttlPath } = await setup();
    const clientMsgId = randomUUID();
    aliceSocket.send({
      type: "message.send",
      client_msg_id: clientMsgId,
      conversation_id: conversationId,
      content_type: "application/vnd.krypto-chat.ttl+json",
      body: '{"ttl_seconds":null}',
    });
    expect(await aliceSocket.next("error")).toMatchObject({
      reason: "invalid_message",
      client_msg_id: clientMsgId,
    });

    await request("PUT", ttlPath, { token: alice.token, body: { ttl_seconds: 300 } });
    expect(
      await request("DELETE", `/conversations/${conversationId}/messages/1`, { token: alice.token }),
    ).toMatchObject({ status: 403, body: { error: "not_your_message" } });
    aliceSocket.close();
    bobSocket.close();
  });
});

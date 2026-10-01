import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import {
  createConversation,
  createUser,
  request,
  sendText,
  TestSocket,
  useTestServer,
} from "./helpers.js";

useTestServer();

async function setup() {
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const conversationId = await createConversation(alice, bob);
  const aliceSocket = await TestSocket.connect(alice);
  const bobSocket = await TestSocket.connect(bob);
  const ack = await sendText(aliceSocket, conversationId, "helo");
  await bobSocket.next("message.new");
  const path = `/conversations/${conversationId}/messages/${ack.seq}`;
  return { alice, bob, conversationId, aliceSocket, bobSocket, path };
}

describe("PATCH /conversations/:id/messages/:seq", () => {
  it("edits the body, numbers the change, and notifies every member's sockets", async () => {
    const { alice, conversationId, aliceSocket, bobSocket, path } = await setup();

    const res = await request("PATCH", path, { token: alice.token, body: { body: "hello" } });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ seq: 1, body: "hello", change_seq: 1, deleted_at: null });
    expect(res.body.message.edited_at).toEqual(expect.any(String));

    for (const socket of [aliceSocket, bobSocket]) {
      const event = await socket.next("message.updated");
      expect(event.message).toMatchObject({ conversation_id: conversationId, body: "hello" });
    }

    const second = await request("PATCH", path, { token: alice.token, body: { body: "hello!" } });
    expect(second.body.message.change_seq).toBe(2);
    const list = await request("GET", "/conversations", { token: alice.token });
    expect(list.body.conversations[0]).toMatchObject({ last_seq: 1, last_change_seq: 2 });
    aliceSocket.close();
    bobSocket.close();
  });

  it("rejects someone else's message, a missing one, and an empty body", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, path } = await setup();
    const eve = await createUser("eve");

    expect(await request("PATCH", path, { token: bob.token, body: { body: "x" } })).toMatchObject({
      status: 403,
      body: { error: "not_your_message" },
    });
    expect(await request("PATCH", path, { token: eve.token, body: { body: "x" } })).toMatchObject({
      status: 404,
      body: { error: "message_not_found" },
    });
    const missing = `/conversations/${conversationId}/messages/99`;
    expect(await request("PATCH", missing, { token: alice.token, body: { body: "x" } })).toMatchObject({
      status: 404,
      body: { error: "message_not_found" },
    });
    expect((await request("PATCH", path, { token: alice.token, body: { body: "" } })).status).toBe(400);
    await bobSocket.expectNone("message.updated");
    aliceSocket.close();
    bobSocket.close();
  });

  it("rejects changes once the edit window has passed", async () => {
    const { alice, aliceSocket, bobSocket, path } = await setup();
    await pool.query("update messages set created_at = now() - interval '16 minutes'");

    expect(await request("PATCH", path, { token: alice.token, body: { body: "x" } })).toMatchObject({
      status: 403,
      body: { error: "edit_window_expired" },
    });
    expect(await request("DELETE", path, { token: alice.token })).toMatchObject({
      status: 403,
      body: { error: "edit_window_expired" },
    });
    aliceSocket.close();
    bobSocket.close();
  });

  it("treats an expired message as gone, even before the sweeper deletes it", async () => {
    const { alice, aliceSocket, bobSocket, path } = await setup();
    await pool.query("update messages set expires_at = now() - interval '1 second'");

    const gone = { status: 404, body: { error: "message_not_found" } };
    const edit = await request("PATCH", path, { token: alice.token, body: { body: "x" } });
    expect(edit).toMatchObject(gone);
    expect(await request("DELETE", path, { token: alice.token })).toMatchObject(gone);
    await bobSocket.expectNone("message.updated");
    aliceSocket.close();
    bobSocket.close();
  });

  it("rejects a body with NUL characters, which Postgres can't store", async () => {
    const { alice, aliceSocket, bobSocket, path } = await setup();
    const res = await request("PATCH", path, { token: alice.token, body: { body: "a\u0000b" } });
    expect(res.status).toBe(400);
    aliceSocket.close();
    bobSocket.close();
  });
});

describe("DELETE /conversations/:id/messages/:seq", () => {
  it("leaves a tombstone with the same seq and blocks further edits", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, path } = await setup();

    const res = await request("DELETE", path, { token: alice.token });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatchObject({ seq: 1, body: "", change_seq: 1 });
    expect(res.body.message.deleted_at).toEqual(expect.any(String));
    expect((await bobSocket.next("message.updated")).message.deleted_at).toEqual(expect.any(String));

    const history = await request("GET", `/conversations/${conversationId}/messages`, {
      token: bob.token,
    });
    expect(history.body.messages).toMatchObject([{ seq: 1, body: "" }]);

    expect(await request("PATCH", path, { token: alice.token, body: { body: "x" } })).toMatchObject({
      status: 409,
      body: { error: "message_deleted" },
    });
    expect((await request("DELETE", path, { token: alice.token })).status).toBe(409);
    aliceSocket.close();
    bobSocket.close();
  });
});

describe("POST /sync changes", () => {
  it("returns messages changed after the change cursor, only where a cursor is sent", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket, path } = await setup();
    await sendText(aliceSocket, conversationId, "second");
    await request("PATCH", path, { token: alice.token, body: { body: "hello" } });
    await request("DELETE", `/conversations/${conversationId}/messages/2`, { token: alice.token });

    const all = await request("POST", "/sync", {
      token: bob.token,
      body: { cursors: { [conversationId]: 2 } },
    });
    expect(all.body.changes.map((m: any) => [m.seq, m.change_seq])).toEqual([
      [1, 1],
      [2, 2],
    ]);

    const after = await request("POST", "/sync", {
      token: bob.token,
      body: { cursors: { [conversationId]: 2 }, change_cursors: { [conversationId]: 1 } },
    });
    expect(after.body.changes.map((m: any) => m.seq)).toEqual([2]);

    const caughtUp = await request("POST", "/sync", {
      token: bob.token,
      body: { cursors: { [conversationId]: 2 }, change_cursors: { [conversationId]: 2 } },
    });
    expect(caughtUp.body.changes).toEqual([]);

    // Without a message cursor, the latest page is already current.
    const fresh = await request("POST", "/sync", { token: bob.token, body: { cursors: {} } });
    expect(fresh.body.changes).toEqual([]);
    expect(fresh.body.messages.map((m: any) => m.body)).toEqual(["hello", ""]);
    aliceSocket.close();
    bobSocket.close();
  });
});

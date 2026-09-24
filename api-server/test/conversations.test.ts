import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import { sendMessage } from "../src/messages/service.js";
import {
  createAuthUser,
  createConversation,
  createUser,
  request,
  TestSocket,
  useTestServer,
} from "./helpers.js";
import { randomUUID } from "node:crypto";

useTestServer();

async function insertMessages(senderId: string, conversationId: string, count: number) {
  for (let i = 1; i <= count; i++) {
    const result = await sendMessage(senderId, {
      client_msg_id: randomUUID(),
      conversation_id: conversationId,
      content_type: "text/plain",
      body: `message ${i}`,
    });
    expect(result.ok).toBe(true);
  }
}

describe("POST /conversations", () => {
  it("creates once, then returns the same conversation from either side", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    const created = await request("POST", "/conversations", {
      token: alice.token,
      body: { peer_id: bob.id },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      last_seq: 0,
      last_message_at: null,
      peer: { id: bob.id, username: "bob", display_name: "BOB" },
      peer_delivered_up_to_seq: 0,
      peer_read_up_to_seq: 0,
    });

    const again = await request("POST", "/conversations", {
      token: alice.token,
      body: { peer_id: bob.id },
    });
    expect(again).toMatchObject({ status: 200, body: { id: created.body.id } });

    const fromBob = await request("POST", "/conversations", {
      token: bob.token,
      body: { peer_id: alice.id },
    });
    expect(fromBob).toMatchObject({
      status: 200,
      body: { id: created.body.id, peer: { id: alice.id } },
    });
  });

  it("returns one conversation when both sides create it at the same time", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        i % 2 === 0
          ? request("POST", "/conversations", { token: alice.token, body: { peer_id: bob.id } })
          : request("POST", "/conversations", { token: bob.token, body: { peer_id: alice.id } }),
      ),
    );
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const { rows } = await pool.query("select count(*)::int as n from conversations");
    expect(rows[0].n).toBe(1);
  });

  it("rejects self, unknown peers, and callers without a profile", async () => {
    const alice = await createUser("alice");
    const noProfile = await createAuthUser();

    const self = await request("POST", "/conversations", {
      token: alice.token,
      body: { peer_id: alice.id },
    });
    expect(self).toEqual({ status: 400, body: { error: "cannot_message_self" } });

    const unknown = await request("POST", "/conversations", {
      token: alice.token,
      body: { peer_id: randomUUID() },
    });
    expect(unknown).toEqual({ status: 404, body: { error: "user_not_found" } });

    const orphan = await request("POST", "/conversations", {
      token: noProfile.token,
      body: { peer_id: alice.id },
    });
    expect(orphan).toEqual({ status: 403, body: { error: "profile_required" } });

    const invalid = await request("POST", "/conversations", {
      token: alice.token,
      body: { peer_id: "not-a-uuid" },
    });
    expect(invalid.status).toBe(400);
  });

  it("notifies the peer's open sockets about a new conversation", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const bobSocket = await TestSocket.connect(bob);

    const id = await createConversation(alice, bob);
    const event = await bobSocket.next("conversation.new");
    expect(event.conversation).toMatchObject({ id, peer: { id: alice.id } });

    await createConversation(alice, bob); // already exists: no second event
    await bobSocket.expectNone("conversation.new");
    bobSocket.close();
  });
});

describe("GET /conversations", () => {
  it("lists only the caller's conversations, most recently active first", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const carol = await createUser("carol");
    const withBob = await createConversation(alice, bob);
    const withCarol = await createConversation(alice, carol);
    await createConversation(bob, carol);

    // Newest first while there are no messages…
    let res = await request("GET", "/conversations", { token: alice.token });
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([withCarol, withBob]);

    // …then by latest message.
    await insertMessages(alice.id, withBob, 1);
    res = await request("GET", "/conversations", { token: alice.token });
    expect(res.body.conversations.map((c: { id: string }) => c.id)).toEqual([withBob, withCarol]);
    expect(res.body.conversations[0]).toMatchObject({ last_seq: 1, peer: { id: bob.id } });
  });
});

describe("GET /conversations/:id/messages", () => {
  it("returns the latest page in seq order and pages backwards", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const id = await createConversation(alice, bob);
    await insertMessages(alice.id, id, 7);

    const latest = await request("GET", `/conversations/${id}/messages?limit=3`, {
      token: bob.token,
    });
    expect(latest.body.messages.map((m: { seq: number }) => m.seq)).toEqual([5, 6, 7]);

    const older = await request("GET", `/conversations/${id}/messages?limit=3&before_seq=5`, {
      token: bob.token,
    });
    expect(older.body.messages.map((m: { seq: number }) => m.seq)).toEqual([2, 3, 4]);
  });

  it("hides conversations from non-members", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const eve = await createUser("eve");
    const id = await createConversation(alice, bob);
    const res = await request("GET", `/conversations/${id}/messages`, { token: eve.token });
    expect(res).toEqual({ status: 404, body: { error: "conversation_not_found" } });
  });
});

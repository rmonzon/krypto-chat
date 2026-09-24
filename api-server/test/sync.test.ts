import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sendMessage } from "../src/messages/service.js";
import { createConversation, createUser, request, useTestServer } from "./helpers.js";

useTestServer();

async function insertMessages(senderId: string, conversationId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await sendMessage(senderId, {
      client_msg_id: randomUUID(),
      conversation_id: conversationId,
      content_type: "text/plain",
      body: `m${i}`,
    });
  }
}

const seqsOf = (messages: { seq: number }[]) => messages.map((m) => m.seq);

describe("POST /sync", () => {
  it("returns the latest page for conversations without a cursor", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const id = await createConversation(alice, bob);
    await insertMessages(alice.id, id, 60);

    const res = await request("POST", "/sync", { token: bob.token, body: { cursors: {} } });
    expect(res.status).toBe(200);
    expect(res.body.has_more).toBe(false);
    expect(seqsOf(res.body.messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 11));
    expect(res.body.conversations).toHaveLength(1);
  });

  it("returns only messages after each cursor, and nothing when caught up", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const carol = await createUser("carol");
    const withBob = await createConversation(alice, bob);
    const withCarol = await createConversation(alice, carol);
    await insertMessages(bob.id, withBob, 5);
    await insertMessages(carol.id, withCarol, 3);

    const res = await request("POST", "/sync", {
      token: alice.token,
      body: { cursors: { [withBob]: 3, [withCarol]: 3 } },
    });
    expect(res.body.messages.map((m: any) => [m.conversation_id, m.seq])).toEqual([
      [withBob, 4],
      [withBob, 5],
    ]);
  });

  it("pages with has_more when a conversation is far behind", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const id = await createConversation(alice, bob);
    await insertMessages(alice.id, id, 150);

    const first = await request("POST", "/sync", { token: bob.token, body: { cursors: { [id]: 0 } } });
    expect(first.body.has_more).toBe(true);
    expect(seqsOf(first.body.messages)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));

    const second = await request("POST", "/sync", {
      token: bob.token,
      body: { cursors: { [id]: 100 } },
    });
    expect(second.body.has_more).toBe(false);
    expect(seqsOf(second.body.messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 101));
  });

  it("never leaks other users' conversations and validates cursors", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    const eve = await createUser("eve");
    const id = await createConversation(alice, bob);
    await insertMessages(alice.id, id, 2);

    const res = await request("POST", "/sync", { token: eve.token, body: { cursors: { [id]: 0 } } });
    expect(res.body).toEqual({ conversations: [], messages: [], has_more: false });

    const bad = await request("POST", "/sync", {
      token: eve.token,
      body: { cursors: { "not-a-uuid": 1 } },
    });
    expect(bad.status).toBe(400);
    const negative = await request("POST", "/sync", {
      token: eve.token,
      body: { cursors: { [id]: -1 } },
    });
    expect(negative.status).toBe(400);
  });
});

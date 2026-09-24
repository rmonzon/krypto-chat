import { describe, expect, it } from "vitest";
import { createConversation, createUser, request, sendText, TestSocket, useTestServer } from "./helpers.js";

useTestServer();

async function setupWithMessages(count: number) {
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const conversationId = await createConversation(alice, bob);
  const aliceSocket = await TestSocket.connect(alice);
  const bobSocket = await TestSocket.connect(bob);
  for (let i = 0; i < count; i++) await sendText(aliceSocket, conversationId, `m${i}`);
  for (let i = 0; i < count; i++) await bobSocket.next("message.new");
  return { alice, bob, conversationId, aliceSocket, bobSocket };
}

describe("receipts", () => {
  it("broadcasts delivered, then read (which implies delivered)", async () => {
    const { bob, conversationId, aliceSocket, bobSocket } = await setupWithMessages(3);

    bobSocket.send({ type: "receipt.delivered", conversation_id: conversationId, seq: 3 });
    expect(await aliceSocket.next("receipt.update")).toEqual({
      type: "receipt.update",
      conversation_id: conversationId,
      user_id: bob.id,
      delivered_up_to_seq: 3,
      read_up_to_seq: 0,
    });

    bobSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 2 });
    expect(await aliceSocket.next("receipt.update")).toMatchObject({
      delivered_up_to_seq: 3,
      read_up_to_seq: 2,
    });
    aliceSocket.close();
    bobSocket.close();
  });

  it("clamps to the conversation's last seq and ignores non-advancing receipts", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setupWithMessages(2);

    bobSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 999 });
    expect(await aliceSocket.next("receipt.update")).toMatchObject({
      delivered_up_to_seq: 2,
      read_up_to_seq: 2,
    });

    bobSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 2 });
    bobSocket.send({ type: "receipt.delivered", conversation_id: conversationId, seq: 1 });
    await aliceSocket.expectNone("receipt.update");
    aliceSocket.close();
    bobSocket.close();
  });

  it("exposes the peer's watermarks in the conversation list", async () => {
    const { alice, conversationId, aliceSocket, bobSocket } = await setupWithMessages(3);
    bobSocket.send({ type: "receipt.delivered", conversation_id: conversationId, seq: 3 });
    bobSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 1 });
    await aliceSocket.next("receipt.update");
    await aliceSocket.next("receipt.update");

    const res = await request("GET", "/conversations", { token: alice.token });
    expect(res.body.conversations[0]).toMatchObject({
      peer_delivered_up_to_seq: 3,
      peer_read_up_to_seq: 1,
    });
    aliceSocket.close();
    bobSocket.close();
  });

  it("ignores receipts from non-members and rejects malformed ones", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setupWithMessages(1);
    const eve = await createUser("eve");
    const eveSocket = await TestSocket.connect(eve);

    eveSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 1 });
    await aliceSocket.expectNone("receipt.update");

    eveSocket.send({ type: "receipt.read", conversation_id: conversationId, seq: 0 });
    expect(await eveSocket.next("error")).toMatchObject({ reason: "invalid_receipt" });
    for (const s of [aliceSocket, bobSocket, eveSocket]) s.close();
  });
});

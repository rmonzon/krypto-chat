import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createConversation, createUser, TestSocket, useTestServer } from "./helpers.js";

useTestServer();

async function setup() {
  const alice = await createUser("alice");
  const bob = await createUser("bob");
  const conversationId = await createConversation(alice, bob);
  const aliceSocket = await TestSocket.connect(alice);
  const bobSocket = await TestSocket.connect(bob);
  return { alice, bob, conversationId, aliceSocket, bobSocket };
}

describe("typing", () => {
  it("relays start and stop to the other member", async () => {
    const { alice, conversationId, aliceSocket, bobSocket } = await setup();

    aliceSocket.send({ type: "typing", conversation_id: conversationId, typing: true });
    expect(await bobSocket.next("typing")).toEqual({
      type: "typing",
      conversation_id: conversationId,
      user_id: alice.id,
      typing: true,
    });

    aliceSocket.send({ type: "typing", conversation_id: conversationId, typing: false });
    expect(await bobSocket.next("typing")).toMatchObject({ typing: false });
    aliceSocket.close();
    bobSocket.close();
  });

  it("doesn't echo to the typer's own sockets", async () => {
    const { alice, conversationId, aliceSocket, bobSocket } = await setup();
    const aliceOtherTab = await TestSocket.connect(alice);

    aliceSocket.send({ type: "typing", conversation_id: conversationId, typing: true });
    await bobSocket.next("typing");
    await aliceOtherTab.expectNone("typing");
    await aliceSocket.expectNone("typing");
    for (const s of [aliceSocket, bobSocket, aliceOtherTab]) s.close();
  });

  it("ignores non-members and rejects malformed events", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setup();
    const eve = await createUser("eve");
    const eveSocket = await TestSocket.connect(eve);

    eveSocket.send({ type: "typing", conversation_id: conversationId, typing: true });
    await bobSocket.expectNone("typing");

    eveSocket.send({ type: "typing", conversation_id: randomUUID(), typing: "yes" });
    expect(await eveSocket.next("error")).toMatchObject({ reason: "invalid_typing" });
    eveSocket.send({ type: "typing", conversation_id: "nope", typing: true });
    expect(await eveSocket.next("error")).toMatchObject({ reason: "invalid_typing" });
    for (const s of [aliceSocket, bobSocket, eveSocket]) s.close();
  });
});

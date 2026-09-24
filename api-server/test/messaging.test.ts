import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pool } from "../src/db.js";
import {
  createConversation,
  createUser,
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
  return { alice, bob, conversationId, aliceSocket, bobSocket };
}

describe("websocket auth", () => {
  it("closes with 4401 for a bad token or a non-auth first message", async () => {
    const bad = await TestSocket.open();
    bad.send({ type: "auth", token: "garbage" });
    expect(await bad.closed).toMatchObject({ code: 4401 });

    const skipped = await TestSocket.open();
    skipped.send({ type: "message.send" });
    expect(await skipped.closed).toMatchObject({ code: 4401 });
  });

  it("replies ready with the user id", async () => {
    const alice = await createUser("alice");
    const socket = await TestSocket.open();
    socket.send({ type: "auth", token: alice.token });
    expect(await socket.next("ready")).toEqual({ type: "ready", user_id: alice.id });
    socket.close();
  });
});

describe("message.send", () => {
  it("acks the sender and delivers to the peer and the sender's other sockets", async () => {
    const { alice, conversationId, aliceSocket, bobSocket } = await setup();
    const aliceOtherTab = await TestSocket.connect(alice);
    const clientMsgId = randomUUID();

    const ack = await sendText(aliceSocket, conversationId, "hello", clientMsgId);
    expect(ack).toMatchObject({ client_msg_id: clientMsgId, conversation_id: conversationId, seq: 1 });

    const received = await bobSocket.next("message.new");
    expect(received.message).toMatchObject({
      conversation_id: conversationId,
      seq: 1,
      sender_id: alice.id,
      client_msg_id: clientMsgId,
      content_type: "text/plain",
      body: "hello",
    });
    expect((await aliceOtherTab.next("message.new")).message.seq).toBe(1);
    await aliceSocket.expectNone("message.new"); // the sending socket only gets the ack

    for (const s of [aliceSocket, bobSocket, aliceOtherTab]) s.close();
  });

  it("dedupes retries of the same client_msg_id", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setup();
    const clientMsgId = randomUUID();

    const first = await sendText(aliceSocket, conversationId, "hi", clientMsgId);
    await bobSocket.next("message.new");
    const retry = await sendText(aliceSocket, conversationId, "hi", clientMsgId);

    expect(retry).toEqual(first);
    await bobSocket.expectNone("message.new");
    const { rows } = await pool.query("select count(*)::int as n from messages");
    expect(rows[0].n).toBe(1);
    aliceSocket.close();
    bobSocket.close();
  });

  it("assigns gap-free seqs in the order a socket sent them", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setup();
    const ids = Array.from({ length: 20 }, () => randomUUID());
    for (const [i, id] of ids.entries()) {
      aliceSocket.send({
        type: "message.send",
        client_msg_id: id,
        conversation_id: conversationId,
        content_type: "text/plain",
        body: `m${i}`,
      });
    }
    const acks = [];
    for (let i = 0; i < ids.length; i++) acks.push(await aliceSocket.next("message.ack"));
    expect(acks.map((a) => a.client_msg_id)).toEqual(ids);
    expect(acks.map((a) => a.seq)).toEqual(ids.map((_, i) => i + 1));
    aliceSocket.close();
    bobSocket.close();
  });

  it("keeps seqs gap-free when both members send at once", async () => {
    const { conversationId, aliceSocket, bobSocket } = await setup();
    const count = 10;
    for (let i = 0; i < count; i++) {
      for (const socket of [aliceSocket, bobSocket]) {
        socket.send({
          type: "message.send",
          client_msg_id: randomUUID(),
          conversation_id: conversationId,
          content_type: "text/plain",
          body: "x",
        });
      }
    }
    const seqs = [];
    for (let i = 0; i < count; i++) {
      seqs.push((await aliceSocket.next("message.ack")).seq, (await bobSocket.next("message.ack")).seq);
    }
    expect(seqs.sort((a, b) => a - b)).toEqual(Array.from({ length: count * 2 }, (_, i) => i + 1));
    aliceSocket.close();
    bobSocket.close();
  });

  it("rejects non-members, reused ids, and malformed messages", async () => {
    const { alice, bob, conversationId, aliceSocket, bobSocket } = await setup();
    const eve = await createUser("eve");
    const eveSocket = await TestSocket.connect(eve);

    const eveMsgId = randomUUID();
    eveSocket.send({
      type: "message.send",
      client_msg_id: eveMsgId,
      conversation_id: conversationId,
      content_type: "text/plain",
      body: "let me in",
    });
    expect(await eveSocket.next("error")).toEqual({
      type: "error",
      reason: "not_a_member",
      client_msg_id: eveMsgId,
    });

    // The same client_msg_id in a different conversation is rejected.
    const carol = await createUser("carol");
    const other = await createConversation(alice, carol);
    const reused = randomUUID();
    await sendText(aliceSocket, conversationId, "first", reused);
    aliceSocket.send({
      type: "message.send",
      client_msg_id: reused,
      conversation_id: other,
      content_type: "text/plain",
      body: "second",
    });
    expect(await aliceSocket.next("error")).toMatchObject({ reason: "duplicate_client_msg_id" });

    const badId = randomUUID();
    aliceSocket.send({ type: "message.send", client_msg_id: badId, conversation_id: conversationId });
    expect(await aliceSocket.next("error")).toEqual({
      type: "error",
      reason: "invalid_message",
      client_msg_id: badId,
    });

    aliceSocket.send({ type: "nope" });
    expect(await aliceSocket.next("error")).toMatchObject({ reason: "unknown_event" });

    await bobSocket.expectNone("error");
    void bob;
    for (const s of [aliceSocket, bobSocket, eveSocket]) s.close();
  });
});

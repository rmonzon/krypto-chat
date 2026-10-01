import { describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";
import { createUser, signToken, TestSocket, useTestServer, wsUrl } from "./helpers.js";

// Short timings so the tests don't wait for the real 5s auth window and 30s heartbeat.
useTestServer({ realtime: { authTimeoutMs: 200, heartbeatMs: 100 } });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("websocket timeouts", () => {
  it("closes a socket that doesn't authenticate in time", async () => {
    const socket = await TestSocket.open();
    expect(await socket.closed).toEqual({ code: 4401, reason: "auth timeout" });
  });

  it("keeps an authenticated socket that answers pings", async () => {
    const alice = await createUser("alice");
    const socket = await TestSocket.connect(alice);

    // Past the auth window and several heartbeats (the client pongs automatically).
    await wait(500);
    socket.send({ type: "nope" });
    expect(await socket.next("error")).toMatchObject({ reason: "unknown_event" });
    socket.close();
  });

  it("drops a connection that stops answering pings", async () => {
    const alice = await createUser("alice");
    const client = new WsClient(wsUrl(), { autoPong: false });
    const closed = new Promise<number>((resolve) => client.on("close", (code) => resolve(code)));
    const ready = new Promise((resolve) =>
      client.on("message", (data) => {
        if (JSON.parse(String(data)).type === "ready") resolve(undefined);
      }),
    );
    await new Promise((resolve) => client.on("open", resolve));
    client.send(JSON.stringify({ type: "auth", token: alice.token }));
    await ready;

    // One unanswered ping, then terminated at the next heartbeat (no close frame).
    expect(await closed).toBe(1006);
  });
});

/** A token that expires in about 2 seconds (exp has whole-second precision). */
const shortLivedToken = (userId: string) => signToken(userId, { expiresIn: "2s" });

describe("websocket token expiry", () => {
  it("closes a socket when its token expires", async () => {
    const alice = await createUser("alice");
    const socket = await TestSocket.connect({ token: await shortLivedToken(alice.id) });
    expect(await socket.closed).toEqual({ code: 4401, reason: "token expired" });
  });

  it("keeps the socket open past expiry when a refreshed token arrives", async () => {
    const alice = await createUser("alice");
    const socket = await TestSocket.connect({ token: await shortLivedToken(alice.id) });

    socket.send({ type: "auth", token: alice.token }); // valid for an hour
    await wait(2_500);
    socket.send({ type: "nope" });
    expect(await socket.next("error")).toMatchObject({ reason: "unknown_event" });
    await socket.expectNone("ready"); // a refresh isn't a new session
    socket.close();
  });

  it("closes the socket on a refresh for another user, or an invalid one", async () => {
    const alice = await createUser("alice");
    const bob = await createUser("bob");

    const switched = await TestSocket.connect(alice);
    switched.send({ type: "auth", token: bob.token });
    expect(await switched.closed).toEqual({ code: 4401, reason: "unauthorized" });

    const garbage = await TestSocket.connect(alice);
    garbage.send({ type: "auth", token: "garbage" });
    expect(await garbage.closed).toEqual({ code: 4401, reason: "unauthorized" });
  });
});

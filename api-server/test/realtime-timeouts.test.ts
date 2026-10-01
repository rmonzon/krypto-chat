import { describe, expect, it } from "vitest";
import { WebSocket as WsClient } from "ws";
import { createUser, TestSocket, useTestServer, wsUrl } from "./helpers.js";

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

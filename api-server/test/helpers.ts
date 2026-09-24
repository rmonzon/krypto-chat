import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { importJWK, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, expect, inject } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db.js";

const env = inject("testEnv");
const privateKey = await importJWK(JSON.parse(env.privateJwk), "ES256");

/** A Supabase-style access token for sub, signed by the fake auth server. */
export function signToken(
  sub: string,
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setSubject(sub)
    .setIssuer(overrides.issuer ?? `${env.supabaseUrl}/auth/v1`)
    .setAudience(overrides.audience ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(privateKey);
}

export type TestUser = { id: string; username: string; token: string };

type Server = { baseUrl: string; wsUrl: string };
let server: Server;

/**
 * Starts the real app on a random port for the current test file, and gives
 * every test an empty database.
 */
export function useTestServer() {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    server = { baseUrl: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/ws` };
  });

  beforeEach(async () => {
    await pool.query(
      "truncate auth.users, profiles, conversations, conversation_members, messages cascade",
    );
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });
}

export async function request<T = any>(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

/** A signed-up Supabase user without an app profile. */
export async function createAuthUser(): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  await pool.query("insert into auth.users (id) values ($1)", [id]);
  return { id, token: await signToken(id) };
}

/** A user with a profile, ready to chat. */
export async function createUser(username: string): Promise<TestUser> {
  const { id, token } = await createAuthUser();
  const res = await request("POST", "/profiles", {
    token,
    body: { username, display_name: username.toUpperCase() },
  });
  expect(res.status).toBe(201);
  return { id, username, token };
}

export async function createConversation(a: TestUser, b: TestUser): Promise<string> {
  const res = await request("POST", "/conversations", { token: a.token, body: { peer_id: b.id } });
  expect([200, 201]).toContain(res.status);
  return res.body.id;
}

type Event = { type: string; [key: string]: any };

/** A WebSocket client that buffers server events so tests can await them. */
export class TestSocket {
  private readonly ws: WebSocket;
  private readonly events: Event[] = [];
  private waiters: Array<{ type: string; resolve: (e: Event) => void }> = [];
  closed: Promise<{ code: number; reason: string }>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => this.push(JSON.parse(String(e.data)));
    this.closed = new Promise((resolve) => {
      ws.onclose = (e) => resolve({ code: e.code, reason: e.reason });
    });
  }

  /** Opens a socket without authenticating. */
  static async open(): Promise<TestSocket> {
    const ws = new WebSocket(server.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("websocket failed to open"));
    });
    return new TestSocket(ws);
  }

  /** Opens and authenticates a socket for user, waiting for `ready`. */
  static async connect(user: { token: string }): Promise<TestSocket> {
    const socket = await TestSocket.open();
    socket.send({ type: "auth", token: user.token });
    await socket.next("ready");
    return socket;
  }

  send(event: object) {
    this.ws.send(JSON.stringify(event));
  }

  /** Resolves with the next event of this type (buffered or future). */
  next(type: string, timeoutMs = 2_000): Promise<Event> {
    const index = this.events.findIndex((e) => e.type === type);
    if (index !== -1) return Promise.resolve(this.events.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = { type, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timed out waiting for ${type}`));
      }, timeoutMs);
    });
  }

  /** Asserts that no event of this type arrives within the window. */
  async expectNone(type: string, windowMs = 300) {
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    expect(this.events.filter((e) => e.type === type)).toEqual([]);
  }

  close() {
    this.ws.close();
  }

  private push(event: Event) {
    const waiter = this.waiters.find((w) => w.type === event.type);
    if (waiter) {
      this.waiters = this.waiters.filter((w) => w !== waiter);
      waiter.resolve(event);
    } else {
      this.events.push(event);
    }
  }
}

/** Sends a text message and returns its ack. */
export async function sendText(
  socket: TestSocket,
  conversationId: string,
  body: string,
  clientMsgId: string = randomUUID(),
) {
  socket.send({
    type: "message.send",
    client_msg_id: clientMsgId,
    conversation_id: conversationId,
    content_type: "text/plain",
    body,
  });
  return socket.next("message.ack");
}

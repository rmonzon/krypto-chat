import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { verifyAccessToken } from "../auth.js";
import {
  advanceReceipt,
  conversationMemberIds,
  type ReceiptKind,
} from "../conversations/service.js";
import { sendMessage, type SendMessageInput } from "../messages/service.js";
import { MAX_BODY_LENGTH, SYSTEM_CONTENT_PREFIX } from "../protocol.js";
import { hasNul } from "../validation.js";
import { addConnection, notifyUser, removeConnection, sendEvent } from "./connections.js";

// Real-time module. The rest of the app should only talk to it through the
// exports below, so it can be extracted into its own service later.
export { notifyUser } from "./connections.js";

const CLOSE_UNAUTHORIZED = 4401;
// setTimeout fires at once for delays past ~24.8 days, so longer waits are chained.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export type RealtimeOptions = {
  /** How long a new socket has to send its auth message. */
  authTimeoutMs?: number;
  /** How often sockets are pinged; one missed pong drops the connection. */
  heartbeatMs?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSendMessage(event: Record<string, unknown>): SendMessageInput | undefined {
  const { client_msg_id, conversation_id, content_type, body } = event;
  if (typeof client_msg_id !== "string" || !UUID.test(client_msg_id)) return undefined;
  if (typeof conversation_id !== "string" || !UUID.test(conversation_id)) return undefined;
  if (typeof content_type !== "string" || content_type.length < 1 || content_type.length > 100)
    return undefined;
  if (hasNul(content_type)) return undefined;
  // Reserved for notices the server posts (e.g. auto-delete changes).
  if (content_type.startsWith(SYSTEM_CONTENT_PREFIX)) return undefined;
  if (typeof body !== "string" || body.length < 1 || body.length > MAX_BODY_LENGTH) return undefined;
  if (hasNul(body)) return undefined;
  return { client_msg_id, conversation_id, content_type, body };
}

function parseReceipt(event: Record<string, unknown>) {
  const { conversation_id, seq } = event;
  if (typeof conversation_id !== "string" || !UUID.test(conversation_id)) return undefined;
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return undefined;
  return { conversation_id, seq };
}

async function handleReceipt(
  userId: string,
  socket: WebSocket,
  kind: ReceiptKind,
  event: Record<string, unknown>,
) {
  const receipt = parseReceipt(event);
  if (!receipt) return sendEvent(socket, { type: "error", reason: "invalid_receipt" });

  const result = await advanceReceipt(userId, receipt.conversation_id, kind, receipt.seq);
  if (!result) return; // no progress, or not a member: nothing to tell anyone

  for (const memberId of result.memberIds) {
    notifyUser(
      memberId,
      {
        type: "receipt.update",
        conversation_id: receipt.conversation_id,
        user_id: userId,
        delivered_up_to_seq: result.delivered_up_to_seq,
        read_up_to_seq: result.read_up_to_seq,
      },
      socket,
    );
  }
}

/**
 * Relays "typing" / "stopped typing" to the conversation's other members.
 * Ephemeral: nothing is stored, and receivers expire it on their own in case
 * the stop never arrives.
 */
async function handleTyping(userId: string, socket: WebSocket, event: Record<string, unknown>) {
  const { conversation_id, typing } = event;
  const validId = typeof conversation_id === "string" && UUID.test(conversation_id);
  if (!validId || typeof typing !== "boolean") {
    return sendEvent(socket, { type: "error", reason: "invalid_typing" });
  }
  const memberIds = await conversationMemberIds(conversation_id);
  if (!memberIds.includes(userId)) return; // not a member: nothing to tell anyone

  for (const memberId of memberIds) {
    if (memberId !== userId) {
      notifyUser(memberId, { type: "typing", conversation_id, user_id: userId, typing });
    }
  }
}

async function handleEvent(userId: string, socket: WebSocket, event: Record<string, unknown>) {
  switch (event.type) {
    case "message.send": {
      const input = parseSendMessage(event);
      if (!input) {
        const client_msg_id =
          typeof event.client_msg_id === "string" ? event.client_msg_id : undefined;
        return sendEvent(socket, { type: "error", reason: "invalid_message", client_msg_id });
      }

      const result = await sendMessage(userId, input);
      if (!result.ok) {
        return sendEvent(socket, {
          type: "error",
          reason: result.reason,
          client_msg_id: input.client_msg_id,
        });
      }

      const { message } = result;
      sendEvent(socket, {
        type: "message.ack",
        client_msg_id: message.client_msg_id,
        conversation_id: message.conversation_id,
        seq: message.seq,
        created_at: message.created_at,
        expires_at: message.expires_at,
      });
      // A retried send was already delivered the first time.
      if (!result.duplicate) {
        for (const memberId of result.memberIds) {
          notifyUser(memberId, { type: "message.new", message }, socket);
        }
      }
      return;
    }
    case "receipt.delivered":
      return handleReceipt(userId, socket, "delivered", event);
    case "receipt.read":
      return handleReceipt(userId, socket, "read", event);
    case "typing":
      return handleTyping(userId, socket, event);
    default:
      return sendEvent(socket, { type: "error", reason: "unknown_event" });
  }
}

function handleConnection(
  socket: WebSocket,
  log: FastifyBaseLogger,
  { authTimeoutMs, heartbeatMs }: Required<RealtimeOptions>,
) {
  let userId: string | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  // Handle one incoming message at a time so a client's sends keep their order.
  let queue = Promise.resolve();

  const authTimer = setTimeout(() => {
    if (!userId) socket.close(CLOSE_UNAUTHORIZED, "auth timeout");
  }, authTimeoutMs);

  // Browsers answer pings automatically; a missed pong means a dead connection.
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, heartbeatMs);
  socket.on("pong", () => {
    alive = true;
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    clearTimeout(expiryTimer);
    clearInterval(heartbeat);
    if (userId) removeConnection(userId, socket);
  });

  /** Closes the socket once its token expires, unless a refreshed token moves the deadline. */
  function closeAt(expiresAt: number | undefined) {
    clearTimeout(expiryTimer);
    if (expiresAt === undefined) return;
    const delay = expiresAt - Date.now();
    expiryTimer =
      delay > MAX_TIMEOUT_MS
        ? setTimeout(() => closeAt(expiresAt), MAX_TIMEOUT_MS)
        : setTimeout(() => socket.close(CLOSE_UNAUTHORIZED, "token expired"), delay);
  }

  /**
   * The first message authenticates the socket. Later ones carry a refreshed
   * token for the same user, which moves the expiry; anything else closes it.
   */
  async function authenticate(token: unknown) {
    let verified;
    try {
      if (typeof token !== "string") throw new Error("no token");
      verified = await verifyAccessToken(token);
    } catch {
      return socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
    }
    if (userId && verified.userId !== userId) {
      return socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
    }
    closeAt(verified.expiresAt);
    if (userId) return; // a refresh: nothing else changes

    userId = verified.userId;
    clearTimeout(authTimer);
    addConnection(userId, socket);
    sendEvent(socket, { type: "ready", user_id: userId });
  }

  async function handleRaw(raw: string) {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      event = parsed as Record<string, unknown>;
    } catch {
      return sendEvent(socket, { type: "error", reason: "invalid_json" });
    }

    if (event.type === "auth") return authenticate(event.token);
    // Anything before a successful auth closes the socket.
    if (!userId) return socket.close(CLOSE_UNAUTHORIZED, "unauthorized");

    try {
      await handleEvent(userId, socket, event);
    } catch (err) {
      log.error({ err, userId }, "websocket event failed");
      const client_msg_id =
        typeof event.client_msg_id === "string" ? event.client_msg_id : undefined;
      sendEvent(socket, { type: "error", reason: "internal_error", client_msg_id });
    }
  }

  socket.on("message", (raw) => {
    queue = queue.then(() => handleRaw(raw.toString()));
  });
}

export async function registerRealtime(
  app: FastifyInstance,
  { authTimeoutMs = 5_000, heartbeatMs = 30_000 }: RealtimeOptions = {},
) {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.get("/ws", { websocket: true }, (socket, request) =>
    handleConnection(socket, request.log, { authTimeoutMs, heartbeatMs }),
  );
}

import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { verifyAccessToken } from "../auth.js";
import { advanceReceipt, type ReceiptKind } from "../conversations/service.js";
import { sendMessage, type SendMessageInput } from "../messages/service.js";
import { addConnection, notifyUser, removeConnection, sendEvent } from "./connections.js";

// Real-time module. The rest of the app should only talk to it through the
// exports below, so it can be extracted into its own service later.
export { notifyUser } from "./connections.js";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const CLOSE_UNAUTHORIZED = 4401;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSendMessage(event: Record<string, unknown>): SendMessageInput | undefined {
  const { client_msg_id, conversation_id, content_type, body } = event;
  if (typeof client_msg_id !== "string" || !UUID.test(client_msg_id)) return undefined;
  if (typeof conversation_id !== "string" || !UUID.test(conversation_id)) return undefined;
  if (typeof content_type !== "string" || content_type.length < 1 || content_type.length > 100)
    return undefined;
  if (typeof body !== "string" || body.length < 1 || body.length > 10_000) return undefined;
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
    default:
      return sendEvent(socket, { type: "error", reason: "unknown_event" });
  }
}

function handleConnection(socket: WebSocket, log: FastifyBaseLogger) {
  let userId: string | undefined;
  let alive = true;
  // Handle one incoming message at a time so a client's sends keep their order.
  let queue = Promise.resolve();

  const authTimer = setTimeout(() => {
    if (!userId) socket.close(CLOSE_UNAUTHORIZED, "auth timeout");
  }, AUTH_TIMEOUT_MS);

  // Browsers answer pings automatically; a missed pong means a dead connection.
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, HEARTBEAT_MS);
  socket.on("pong", () => {
    alive = true;
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    clearInterval(heartbeat);
    if (userId) removeConnection(userId, socket);
  });

  async function handleRaw(raw: string) {
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
      event = parsed as Record<string, unknown>;
    } catch {
      return sendEvent(socket, { type: "error", reason: "invalid_json" });
    }

    // The first message must be { type: "auth", token }.
    if (!userId) {
      if (event.type !== "auth" || typeof event.token !== "string") {
        return socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
      }
      try {
        userId = await verifyAccessToken(event.token);
      } catch {
        return socket.close(CLOSE_UNAUTHORIZED, "unauthorized");
      }
      clearTimeout(authTimer);
      addConnection(userId, socket);
      return sendEvent(socket, { type: "ready", user_id: userId });
    }

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

export async function registerRealtime(app: FastifyInstance) {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.get("/ws", { websocket: true }, (socket, request) => handleConnection(socket, request.log));
}

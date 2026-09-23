import type { WebSocket } from "ws";
import type { ServerEvent } from "./events.js";

// userId → that user's open sockets (one per tab/device). In-memory, so this
// only works with a single server instance; see architecture.md.
const connections = new Map<string, Set<WebSocket>>();

export function addConnection(userId: string, socket: WebSocket) {
  let sockets = connections.get(userId);
  if (!sockets) connections.set(userId, (sockets = new Set()));
  sockets.add(socket);
}

export function removeConnection(userId: string, socket: WebSocket) {
  const sockets = connections.get(userId);
  sockets?.delete(socket);
  if (sockets?.size === 0) connections.delete(userId);
}

export function sendEvent(socket: WebSocket, event: ServerEvent) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
}

/** Pushes an event to all of a user's open sockets, optionally skipping one. */
export function notifyUser(userId: string, event: ServerEvent, except?: WebSocket) {
  const data = JSON.stringify(event);
  for (const socket of connections.get(userId) ?? []) {
    if (socket !== except && socket.readyState === socket.OPEN) socket.send(data);
  }
}

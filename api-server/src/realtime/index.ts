import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";

// Real-time module. The rest of the app should only talk to it through the
// functions exported here (e.g. notifyUser), so it can be extracted later.
export async function registerRealtime(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (socket) => {
    socket.on("message", (raw) => {
      // Placeholder until step 4: answer pings so the connection can be tested.
      if (raw.toString() === "ping") socket.send("pong");
    });
  });
}

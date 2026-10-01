import type { FastifyInstance } from "fastify";
import { listConversations } from "../conversations/service.js";
import { changesAfter, latestMessages, messagesAfter } from "../messages/service.js";

const PAGE_SIZE = 100;
const LATEST_PAGE_SIZE = 50;

type SyncBody = { cursors: Record<string, number>; change_cursors?: Record<string, number> };

export async function syncRoutes(app: FastifyInstance) {
  /**
   * Catch-up after (re)connecting. `cursors` maps conversation id → the seq
   * the client has everything up to. Returns all the caller's conversations
   * (with current watermarks) plus:
   * - with a cursor: messages after it, up to PAGE_SIZE per conversation
   * - without one: the latest page (older history loads on demand)
   * - with a cursor: `changes`, the current state of messages edited or
   *   deleted after its change cursor (`change_cursors`, missing means 0), up
   *   to PAGE_SIZE per conversation. Clients only apply them to messages they
   *   have; anything else arrives in its current state when fetched.
   * has_more means some conversation had more than a page; call again with
   * the advanced cursors.
   */
  app.post<{ Body: SyncBody }>(
    "/sync",
    {
      schema: {
        body: {
          type: "object",
          required: ["cursors"],
          properties: {
            cursors: {
              type: "object",
              propertyNames: { format: "uuid" },
              additionalProperties: { type: "integer", minimum: 0 },
              maxProperties: 5000,
            },
            change_cursors: {
              type: "object",
              propertyNames: { format: "uuid" },
              additionalProperties: { type: "integer", minimum: 0 },
              maxProperties: 5000,
            },
          },
        },
      },
    },
    async (request) => {
      const { cursors, change_cursors: changeCursors = {} } = request.body;
      const conversations = await listConversations(request.userId);
      let hasMore = false;

      const pages = await Promise.all(
        conversations.map(async (c) => {
          const cursor = cursors[c.id];
          if (cursor === undefined) {
            return c.last_seq > 0 ? latestMessages(c.id, LATEST_PAGE_SIZE) : [];
          }
          if (cursor >= c.last_seq) return [];
          const page = await messagesAfter(c.id, cursor, PAGE_SIZE);
          if (page.length === PAGE_SIZE && page[page.length - 1]!.seq < c.last_seq) hasMore = true;
          return page;
        }),
      );

      const changePages = await Promise.all(
        conversations.map(async (c) => {
          // No cursor: the client has nothing to apply changes to; the latest page is current.
          if (cursors[c.id] === undefined) return [];
          const changeCursor = changeCursors[c.id] ?? 0;
          if (changeCursor >= c.last_change_seq) return [];
          const page = await changesAfter(c.id, changeCursor, PAGE_SIZE);
          if (page.length === PAGE_SIZE && page[page.length - 1]!.change_seq! < c.last_change_seq) {
            hasMore = true;
          }
          return page;
        }),
      );

      return {
        conversations,
        messages: pages.flat(),
        changes: changePages.flat(),
        has_more: hasMore,
      };
    },
  );
}

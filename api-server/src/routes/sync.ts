import type { FastifyInstance } from "fastify";
import { listConversations } from "../conversations/service.js";
import {
  changesAfter,
  latestMessages,
  messagesAfter,
  type MessageDto,
} from "../messages/service.js";

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
   * - `synced_up_to`: per conversation, the seq the client now has every
   *   message up to (the rest expired). Seqs can have gaps, so clients move
   *   their cursor here rather than to the last message they got.
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
      const syncedUpTo: Record<string, number> = {};

      const pages = await Promise.all(
        conversations.map(async (c) => {
          const cursor = cursors[c.id];
          // last_seq was read before these queries, so everything up to it is
          // either returned or gone; later sends may be returned too.
          const upTo = (page: MessageDto[]) =>
            Math.max(c.last_seq, cursor ?? 0, page.at(-1)?.seq ?? 0);
          if (cursor === undefined) {
            const page = c.last_seq > 0 ? await latestMessages(c.id, LATEST_PAGE_SIZE) : [];
            syncedUpTo[c.id] = upTo(page);
            return page;
          }
          if (cursor >= c.last_seq) {
            syncedUpTo[c.id] = cursor;
            return [];
          }
          const page = await messagesAfter(c.id, cursor, PAGE_SIZE);
          if (page.length === PAGE_SIZE && page[page.length - 1]!.seq < c.last_seq) {
            // Only up to this page: the next call continues after it.
            hasMore = true;
            syncedUpTo[c.id] = page[page.length - 1]!.seq;
          } else {
            syncedUpTo[c.id] = upTo(page);
          }
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
        synced_up_to: syncedUpTo,
        has_more: hasMore,
      };
    },
  );
}

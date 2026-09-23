import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export async function userRoutes(app: FastifyInstance) {
  // Username prefix search, excluding the caller.
  app.get<{ Querystring: { q: string } }>(
    "/users",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", minLength: 1, maxLength: 30 } },
        },
      },
    },
    async (request) => {
      // Escape LIKE wildcards; `_` is valid in usernames.
      const prefix = request.query.q.trim().toLowerCase().replace(/[\\%_]/g, "\\$&");
      const { rows } = await pool.query(
        `select id, username, display_name from profiles
         where username like $1 and id <> $2
         order by username
         limit 20`,
        [`${prefix}%`, request.userId],
      );
      return { users: rows };
    },
  );
}

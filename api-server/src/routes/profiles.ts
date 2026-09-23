import type { FastifyInstance } from "fastify";
import { DatabaseError } from "pg";
import { pool } from "../db.js";

type CreateProfileBody = { username: string; display_name: string };

export async function profileRoutes(app: FastifyInstance) {
  app.get("/me", async (request, reply) => {
    const { rows } = await pool.query(
      "select id, username, display_name from profiles where id = $1",
      [request.userId],
    );
    if (!rows[0]) return reply.code(404).send({ error: "profile_not_found" });
    return rows[0];
  });

  app.post<{ Body: CreateProfileBody }>(
    "/profiles",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "display_name"],
          additionalProperties: false,
          properties: {
            username: { type: "string", pattern: "^[a-z0-9_]{3,30}$" },
            display_name: { type: "string", minLength: 1, maxLength: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, display_name } = request.body;
      try {
        const { rows } = await pool.query(
          `insert into profiles (id, username, display_name) values ($1, $2, $3)
           returning id, username, display_name`,
          [request.userId, username, display_name.trim()],
        );
        return reply.code(201).send(rows[0]);
      } catch (err) {
        if (err instanceof DatabaseError && err.code === "23505") {
          const error = err.constraint === "profiles_pkey" ? "profile_exists" : "username_taken";
          return reply.code(409).send({ error });
        }
        throw err;
      }
    },
  );
}

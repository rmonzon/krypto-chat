// Dev helper: fills a 1:1 conversation with numbered messages, alternating
// senders, e.g. to try out history paging.
//   pnpm seed:messages <username-a> <username-b> [count=200]
import { randomUUID } from "node:crypto";
import { pool } from "../src/db.js";
import { sendMessage } from "../src/messages/service.js";

const [usernameA, usernameB, countArg = "200"] = process.argv.slice(2);
const count = Number(countArg);
if (!usernameA || !usernameB || !Number.isInteger(count) || count < 1) {
  console.error("Usage: pnpm seed:messages <username-a> <username-b> [count=200]");
  process.exit(1);
}

try {
  const { rows: users } = await pool.query<{ id: string; username: string }>(
    "select id, username from profiles where username = any($1)",
    [[usernameA, usernameB]],
  );
  const a = users.find((u) => u.username === usernameA);
  const b = users.find((u) => u.username === usernameB);
  if (!a || !b) throw new Error(`Unknown username(s): ${[usernameA, usernameB].join(", ")}`);

  const { rows } = await pool.query<{ id: string }>(
    "select id from conversations where direct_key = $1",
    [[a.id, b.id].sort().join(":")],
  );
  const conversationId = rows[0]?.id;
  if (!conversationId) throw new Error("Start a conversation between them in the app first.");

  for (let i = 1; i <= count; i++) {
    const sender = i % 2 === 0 ? b : a;
    await sendMessage(sender.id, {
      client_msg_id: randomUUID(),
      conversation_id: conversationId,
      content_type: "text/plain",
      body: `Seed message ${i} from @${sender.username}`,
    });
  }
  console.log(`Added ${count} messages to the conversation between @${a.username} and @${b.username}.`);
} finally {
  await pool.end();
}

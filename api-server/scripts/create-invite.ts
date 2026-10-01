// Admin helper: mints a sign-up invite that isn't tied to any user, e.g. to
// let the first person into a fresh environment.
//   pnpm invite:create [--minutes 10]
import { pool } from "../src/db.js";
import { createInvite, INVITE_TTL_MS } from "../src/invites/service.js";

const args = process.argv.slice(2);
const minutesAt = args.indexOf("--minutes");
const minutes = minutesAt === -1 ? INVITE_TTL_MS / 60_000 : Number(args[minutesAt + 1]);
if (!Number.isFinite(minutes) || minutes <= 0 || (args.length && minutesAt === -1)) {
  console.error("Usage: pnpm invite:create [--minutes <n>]");
  process.exit(1);
}

try {
  const invite = await createInvite(pool, null, minutes * 60_000);
  console.log(`Invite code: ${invite.code}`);
  console.log(`Sign up with it before ${invite.expires_at.toISOString()}.`);
} finally {
  await pool.end();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

/**
 * TRUST_PROXY: whether the client IP (which rate limits key on) comes from
 * X-Forwarded-For. Unset: no, the connecting address is the client. "true":
 * trust any proxy; otherwise a comma-separated list of the proxies' IPs or
 * CIDRs. Only set it behind a proxy you control, since clients can put
 * anything in that header.
 */
export function parseTrustProxy(value: string | undefined): boolean | string[] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "false") return false;
  if (trimmed === "true") return true;
  return trimmed.split(",").map((s) => s.trim());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  databaseUrl: required("DATABASE_URL"),
  supabaseUrl: required("SUPABASE_URL").replace(/\/$/, ""),
};

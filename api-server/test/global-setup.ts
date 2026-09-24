// Starts a throwaway Postgres (same major version as Supabase) and a local
// JWKS endpoint that stands in for Supabase Auth, so tests exercise the real
// token verification and SQL.
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { exportJWK, generateKeyPair } from "jose";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../src/migrate.js";

export type TestEnv = { databaseUrl: string; supabaseUrl: string; privateJwk: string };

declare module "vitest" {
  export interface ProvidedContext {
    testEnv: TestEnv;
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export default async function setup(project: TestProject) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "krypto-chat-pg-"));
  const port = await freePort();
  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("krypto_test");
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${port}/krypto_test`;

  // Minimal stand-in for Supabase's auth schema, which profiles references.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("create schema auth; create table auth.users (id uuid primary key);");
  await client.end();
  await runMigrations(databaseUrl, () => {});

  // Fake Supabase Auth: tests sign tokens with this key; the server fetches the JWKS.
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "test-key", alg: "ES256", use: "sig" }] };
  const jwksServer = createServer((req, res) => {
    if (req.url === "/auth/v1/.well-known/jwks.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(jwks));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  const jwksPort = await listen(jwksServer);

  project.provide("testEnv", {
    databaseUrl,
    supabaseUrl: `http://127.0.0.1:${jwksPort}`,
    privateJwk: JSON.stringify(await exportJWK(privateKey)),
  });

  return async () => {
    await new Promise((resolve) => jwksServer.close(resolve));
    await postgres.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
}

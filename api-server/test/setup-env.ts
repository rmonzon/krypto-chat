// Runs before each test file's imports, so src/config.ts sees these values.
import { inject } from "vitest";

const env = inject("testEnv");
process.env.DATABASE_URL = env.databaseUrl;
process.env.SUPABASE_URL = env.supabaseUrl;

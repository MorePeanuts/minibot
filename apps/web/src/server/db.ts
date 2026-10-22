import "server-only";
import { createDb, type Db } from "@minibot/db";
import { env } from "@/env";

// Re-use one connection pool across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: Db };

export const db = globalForDb.db ?? createDb(env.DATABASE_URL);
if (env.NODE_ENV !== "production") globalForDb.db = db;

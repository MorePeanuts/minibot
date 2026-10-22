/**
 * Applies pending SQL migrations from ./drizzle. Used by `pnpm db:migrate`
 * and by the one-shot `migrate` service in docker-compose.
 */
import "./env";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const db = createDb(url, { max: 1 });
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

console.info("⏳ Running migrations...");
await migrate(db, { migrationsFolder });
console.info("✅ Migrations applied");
await db.$client.end();

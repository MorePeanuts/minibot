import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, { max: options.max ?? 10 });
  return drizzle(client, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;
/** A transaction handle has the same query API as the root db. */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

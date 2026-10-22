import { sql } from "@minibot/db";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe used by Docker's HEALTHCHECK. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}

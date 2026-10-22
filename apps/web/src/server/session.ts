import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

/** Reads the session once per request (React `cache` de-duplicates calls). */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** For pages and server actions: redirects to /login when unauthenticated. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

import { createUIMessageStreamResponse } from "ai";
import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { ChatError, chatRequestSchema, runChat } from "@/server/chat/run-chat";
import { NotFoundError } from "@/server/services/conversations";

// Agent runs with tool calls can take a while.
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = chatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const stream = await runChat(session.user.id, parsed.data, request.signal);
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    if (error instanceof ChatError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof NotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

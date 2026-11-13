import { downloadLimitBytes, workspaceDownloadPath } from "@minibot/sandbox";
import { z } from "zod";
import { auth } from "@/server/auth";
import { sandboxManager } from "@/server/sandbox";
import { findWorkspaceDownload } from "@/server/services/downloads";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const input = z.object({ id: z.uuid(), conversationId: z.uuid() }).safeParse({
    ...(await context.params),
    conversationId: url.searchParams.get("conversationId"),
  });
  if (!input.success) return Response.json({ error: "Download not found" }, { status: 404 });
  const { id, conversationId } = input.data;
  const filename = await findWorkspaceDownload(session.user.id, conversationId, id);
  if (!filename) return Response.json({ error: "Download not found" }, { status: 404 });
  let bytes: Buffer;
  try {
    const sandbox = await sandboxManager.acquire(conversationId);
    bytes = await sandbox.readWorkspaceFile(
      workspaceDownloadPath(sandbox.workdir, id),
      downloadLimitBytes,
      request.signal,
    );
  } catch {
    return Response.json({ error: "Download unavailable" }, { status: 404 });
  }
  const encoded = encodeURIComponent(Buffer.from(filename).toString("utf8")).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16)}`,
  );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { z } from "zod";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import {
  cleanupProviderFiles,
  deleteDraftAttachments,
  findDownload,
} from "@/server/services/attachments";
import { getAgentSettings } from "@/server/services/settings";

type AttachmentRouteContext = { params: Promise<{ id: string }> };

async function authorize(request: Request, context: AttachmentRouteContext) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.uuid(), conversationId: z.uuid() }).safeParse({
    ...(await context.params),
    conversationId: new URL(request.url).searchParams.get("conversationId"),
  });
  if (!parsed.success) return Response.json({ error: "Attachment not found" }, { status: 404 });
  return { userId: session.user.id, ...parsed.data };
}

export async function GET(request: Request, context: AttachmentRouteContext) {
  const access = await authorize(request, context);
  if (access instanceof Response) return access;
  const file = await findDownload(access.userId, access.conversationId, access.id);
  if (!file) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const filename = encodeURIComponent(Buffer.from(file.filename).toString("utf8")).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16)}`,
  );
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: Request, context: AttachmentRouteContext) {
  const access = await authorize(request, context);
  if (access instanceof Response) return access;
  const settings = await getAgentSettings(access.userId);
  const files = await deleteDraftAttachments(db, access.userId, access.conversationId, access.id);
  if (!files.length) return Response.json({ error: "Attachment not found" }, { status: 404 });
  await cleanupProviderFiles(settings.apiKey, files);
  return new Response(null, { status: 204 });
}

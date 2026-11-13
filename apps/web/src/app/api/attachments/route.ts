import { z } from "zod";
import { auth } from "@/server/auth";
import { DeepSeekFileError } from "@minibot/agent";
import { documentPurpose, maxDocumentSize } from "@/lib/chat/attachments";
import { expireDraftAttachments, uploadDocument } from "@/server/services/attachments";
import { getAgentSettings } from "@/server/services/settings";

export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const conversationId = z.uuid().safeParse(searchParams.get("conversationId"));
  if (!conversationId.success)
    return Response.json({ error: "Invalid conversation" }, { status: 400 });
  const userId = session.user.id;
  const settings = await getAgentSettings(userId);
  if (!settings.apiKey)
    return Response.json(
      { error: "Add your DeepSeek API key in Settings first." },
      { status: 400 },
    );

  const filename = searchParams.get("filename") ?? "";
  const rich = searchParams.get("layout") === "rich";
  if (
    !filename ||
    filename.includes("\0") ||
    Buffer.byteLength(filename) > 512 ||
    !documentPurpose(filename, rich)
  ) {
    return Response.json({ error: "Unsupported document format or filename." }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > maxDocumentSize) {
    return Response.json({ error: "Documents must be 20 MiB or smaller." }, { status: 413 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Empty document." }, { status: 400 });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxDocumentSize) {
        await reader.cancel();
        return Response.json({ error: "Documents must be 20 MiB or smaller." }, { status: 413 });
      }
      chunks.push(new Uint8Array(value));
    }
  } catch {
    return Response.json({ error: "Document upload was interrupted." }, { status: 400 });
  }
  if (!size) return Response.json({ error: "Empty document." }, { status: 400 });

  try {
    const file = new File(chunks, filename, { type: request.headers.get("content-type") ?? "" });
    await expireDraftAttachments(userId, settings.apiKey);
    return Response.json(
      await uploadDocument(userId, conversationId.data, settings.apiKey, file, rich),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DeepSeekFileError) {
      const messages: Partial<Record<number, string>> = {
        400: "DeepSeek could not parse this document. Check the format and remove any password protection.",
        401: "DeepSeek rejected the API key. Check Settings.",
        402: "DeepSeek account has insufficient balance.",
        413: "DeepSeek rejected the document because it is too large.",
        429: "DeepSeek is handling too many uploads. Try again shortly.",
        504: "DeepSeek timed out parsing the document. Try a smaller document.",
      };
      return Response.json(
        { error: messages[error.status] ?? "DeepSeek could not upload the document. Try again." },
        { status: 502 },
      );
    }
    console.error("document upload failed", error);
    return Response.json({ error: "Could not upload the document. Try again." }, { status: 502 });
  }
}

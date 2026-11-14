import { z } from "zod";
import { auth } from "@/server/auth";
import { DeepSeekFileError } from "@minibot/agent";
import {
  documentPurpose,
  imageExtensions,
  maxDocumentSize,
  maxImageSize,
} from "@/lib/chat/attachments";
import { expireDraftAttachments, uploadAttachment } from "@/server/services/attachments";
import { imageMediaType } from "@/server/services/image-format";
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
  if (settings.chatProvider === "responses") {
    return Response.json(
      { error: "Attachments are unavailable with the custom Responses provider." },
      { status: 400 },
    );
  }
  if (!settings.apiKey)
    return Response.json(
      { error: "Add your DeepSeek API key in Settings first." },
      { status: 400 },
    );

  const filename = searchParams.get("filename") ?? "";
  const imageUpload = searchParams.get("kind") === "image";
  const maxSize = imageUpload ? maxImageSize : maxDocumentSize;
  const sizeError = () =>
    Response.json({ error: "Attachments must be 20 MiB or smaller." }, { status: 413 });
  if (filename.includes("\0") || Buffer.byteLength(filename) > 512) {
    return Response.json({ error: "Invalid attachment filename." }, { status: 400 });
  }
  if (Number(request.headers.get("content-length")) > maxSize) return sizeError();
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Empty attachment." }, { status: 400 });

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSize) {
        await reader.cancel();
        return sizeError();
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "Attachment upload was interrupted." }, { status: 400 });
  }
  if (!size) return Response.json({ error: "Empty attachment." }, { status: 400 });

  const bytes = Buffer.concat(chunks, size);
  const mediaType = imageMediaType(bytes);
  if (imageUpload && !mediaType) {
    return Response.json(
      { error: "Choose a valid JPEG, PNG, GIF, or WebP image." },
      { status: 400 },
    );
  }
  if (mediaType && size > maxImageSize) return sizeError();
  const purpose = mediaType ? "user_data" : documentPurpose(filename);
  if (!purpose) {
    return Response.json({ error: "Unsupported attachment format or filename." }, { status: 400 });
  }
  const name = mediaType
    ? `${filename.replace(/\.[^./]+$/, "") || "Screenshot"}.${imageExtensions[mediaType]}`
    : filename;
  const declaredType = request.headers.get("content-type") ?? "";
  const type = mediaType ?? (declaredType.startsWith("image/") ? "" : declaredType);

  try {
    const file = new File([bytes], name, { type });
    await expireDraftAttachments(userId, settings.apiKey);
    return Response.json(
      await uploadAttachment(userId, conversationId.data, settings.apiKey, file, purpose),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DeepSeekFileError) {
      const messages: Partial<Record<number, string>> = {
        400: "DeepSeek could not read this attachment. Check its format and any password protection.",
        401: "DeepSeek rejected the API key. Check Settings.",
        402: "DeepSeek account has insufficient balance.",
        413: "DeepSeek rejected the attachment because it is too large.",
        429: "DeepSeek is handling too many uploads. Try again shortly.",
        504: "DeepSeek timed out processing the attachment. Try a smaller file.",
      };
      return Response.json(
        { error: messages[error.status] ?? "DeepSeek could not upload the attachment. Try again." },
        { status: 502 },
      );
    }
    console.error("attachment upload failed", error);
    return Response.json({ error: "Could not upload the attachment. Try again." }, { status: 502 });
  }
}

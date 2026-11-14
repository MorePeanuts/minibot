import "server-only";
import type { ResponsesAttachment } from "@minibot/agent";
import { and, eq, inArray, schema, type DbExecutor } from "@minibot/db";
import { isImageMediaType } from "@/lib/chat/attachments";

export const maxResponsesAttachmentBytes = 50_000_000;

const documentMediaTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  yaml: "application/yaml",
  yml: "application/yaml",
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
};

export async function loadResponsesAttachments(tx: DbExecutor, userId: string, ids: string[]) {
  const result = new Map<string, ResponsesAttachment>();
  if (!ids.length) return result;
  const { attachment } = schema;
  const originals = await tx
    .select({
      id: attachment.id,
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
    })
    .from(attachment)
    .where(and(eq(attachment.userId, userId), inArray(attachment.id, ids)));
  if (originals.length !== ids.length) throw new Error("Missing original attachment.");
  for (const { id, filename, mediaType, bytes } of originals) {
    const data = bytes.toString("base64");
    if (isImageMediaType(mediaType)) {
      result.set(id, {
        type: "input_image",
        image_url: `data:${mediaType};base64,${data}`,
        detail: "auto",
      });
    } else {
      const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
      const mime = documentMediaTypes[extension] ?? "text/plain";
      result.set(id, { type: "input_file", filename, file_data: `data:${mime};base64,${data}` });
    }
  }
  return result;
}

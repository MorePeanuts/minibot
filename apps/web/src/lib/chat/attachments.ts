const parsedExtensions = ["pdf", "doc", "docx", "ppt", "pptx"];
const dataExtensions = [
  "txt",
  "md",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "js",
  "ts",
  "py",
  "html",
  "css",
  "sql",
  "xls",
  "xlsx",
  "epub",
  "mobi",
];
export const documentAccept = [...parsedExtensions, ...dataExtensions]
  .map((extension) => `.${extension}`)
  .join(",");
export const maxDocumentSize = 20 * 1024 * 1024;
export const maxMessageAttachments = 20;

export function documentPurpose(filename: string, richLayout: boolean) {
  const dot = filename.lastIndexOf(".");
  if (dot < 1) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  if (parsedExtensions.includes(extension))
    return richLayout ? "rich_layout_recognition" : "text_recognition";
  if (dataExtensions.includes(extension)) return "user_data";
  return null;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mediaType: string;
}

export function attachmentUrl(id: string, conversationId: string) {
  return `/api/attachments/${id}?conversationId=${encodeURIComponent(conversationId)}`;
}

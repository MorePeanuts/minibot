import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { downloadLimitBytes, workspaceDownloadPath } from "@minibot/sandbox";
import type { OcrPage, OcrPurpose } from "../deepseek-ocr";
import type { SandboxProvider } from "./sandbox";

export interface DocumentAccess {
  read: (id: string) => Promise<{ id: string; filename: string; bytes: Buffer }>;
  recognize?: (id: string, purpose: OcrPurpose, signal?: AbortSignal) => Promise<OcrPage[]>;
}

export interface WorkspaceDownload {
  id: string;
  filename: string;
}

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
const attachmentId = Type.String({ description: "Internal attachment ID from the user turn." });

function waitForOcr(result: Promise<OcrPage[]>, signal?: AbortSignal) {
  if (!signal) return result;
  return new Promise<OcrPage[]>((resolve, reject) => {
    const abort = () =>
      reject(
        new Error(
          "Stopped waiting for OCR. Submitted recognition may still complete and be charged.",
        ),
      );
    signal.addEventListener("abort", abort, { once: true });
    void result.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export function createDocumentTools(
  getSandbox: SandboxProvider,
  documents: DocumentAccess,
): AgentTool<any>[] {
  const readParameters = Type.Object({ attachmentId });
  const read: AgentTool<typeof readParameters> = {
    name: "read_attachment",
    label: "Copy attachment to workspace",
    description: "Copy a user attachment's original bytes into the sandbox for processing.",
    parameters: readParameters,
    executionMode: "sequential",
    async execute(_callId, args, signal) {
      const file = await documents.read(args.attachmentId);
      signal?.throwIfAborted();
      const sandbox = await getSandbox();
      const filename = path.posix.basename(file.filename);
      const output = `${sandbox.workdir}/attachments/${file.id}/${randomUUID()}-${filename}`;
      await sandbox.writeFile(output, file.bytes);
      return textResult(`Original attachment copied to ${output}.`);
    },
  };
  const recognizeDocument = documents.recognize;
  if (!recognizeDocument) return [read];
  const ocrParameters = Type.Object({
    attachmentId,
    purpose: Type.Optional(
      Type.Union([Type.Literal("text_recognition"), Type.Literal("rich_layout_recognition")], {
        description:
          "Use rich_layout_recognition to force page-by-page layout recognition. Default: text_recognition.",
      }),
    ),
  });
  const recognize: AgentTool<typeof ocrParameters> = {
    name: "ocr_document",
    label: "Recognize document text",
    description:
      "Recognize text in an uploaded PDF, Word, PowerPoint or image. Saves per-page raw text, layout markers and completion status as JSON in the sandbox. Use when the user asks for OCR or needs page-level data.",
    parameters: ocrParameters,
    executionMode: "sequential",
    async execute(_callId, args, signal) {
      const purpose = args.purpose ?? "text_recognition";
      const pages = await waitForOcr(recognizeDocument(args.attachmentId, purpose, signal), signal);
      signal?.throwIfAborted();
      const sandbox = await getSandbox();
      const output = `${sandbox.workdir}/ocr/${randomUUID()}.json`;
      await sandbox.writeFile(output, JSON.stringify({ purpose, pages }, null, 2));
      const partial = pages
        .filter((page) => page.finish_reason === "length")
        .map((page) => page.index + 1);
      const warning = partial.length
        ? ` ${partial.length} page(s) were truncated (page numbers ${partial.slice(0, 20).join(", ")}${partial.length > 20 ? ", …" : ""}).`
        : "";
      return textResult(
        `OCR returned ${pages.length} page(s).${warning} Raw page text and status saved to ${output}.`,
      );
    },
  };
  return [read, recognize];
}

const exportParameters = Type.Object({
  path: Type.String({ description: "Path to a regular file within the sandbox workspace." }),
});

export function createExportFileTool(
  getSandbox: SandboxProvider,
): AgentTool<typeof exportParameters> {
  return {
    name: "export_file",
    label: "Make file downloadable",
    description:
      "Make a generated workspace file available to the user as a downloadable snapshot. Call this after producing a file the user requested.",
    parameters: exportParameters,
    executionMode: "sequential",
    async execute(_callId, args, signal) {
      const sandbox = await getSandbox();
      const bytes = await sandbox.readWorkspaceFile(args.path, downloadLimitBytes, signal);
      const download: WorkspaceDownload = {
        id: randomUUID(),
        filename: path.posix.basename(args.path).replace(/[\\\p{Cc}]/gu, "_"),
      };
      await sandbox.writeFile(workspaceDownloadPath(sandbox.workdir, download.id), bytes);
      return {
        ...textResult(
          `A downloadable copy of ${download.filename} is attached to this tool result.`,
        ),
        details: { download },
      };
    },
  };
}

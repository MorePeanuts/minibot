import { randomUUID } from "node:crypto";
import { createDb, eq, schema } from "@minibot/db";
import { expect, it, vi } from "vitest";
import { linkMessageAttachments } from "./attachments";
import { forkConversation, getOrCreateConversation, insertMessage } from "./conversations";
import { findWorkspaceDownload } from "./downloads";
import { recognizeChatAttachment } from "./ocr";

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({
  db: process.env.ATTACHMENT_TEST_DATABASE_URL
    ? createDb(process.env.ATTACHMENT_TEST_DATABASE_URL)
    : undefined,
}));
vi.mock("./settings", () => ({ getAgentSettings: vi.fn() }));
vi.mock("../sandbox", () => ({
  sandboxManager: { copyWorkspace: vi.fn(async () => {}) },
}));

it.skipIf(!process.env.ATTACHMENT_TEST_DATABASE_URL)(
  "authorizes OCR and exports against the conversation and reuses one result across forks",
  async () => {
    const { db } = await import("../db");
    const userId = randomUUID();
    const other = randomUUID();
    const source = randomUUID();
    const fileId = randomUUID();
    const exportId = randomUUID();
    const pages = [{ index: 0, text: "example", finish_reason: "stop" }];
    const fetch = vi.fn(async (_input: string, init: RequestInit) => {
      const purpose = (init.body as FormData).get("purpose");
      const file = (init.body as FormData).get("file") as File;
      expect(await file.text()).toBe("original");
      return Response.json({ object: "ocr.result", page_count: 1, purpose, pages });
    });
    vi.stubGlobal("fetch", fetch);
    try {
      await db
        .insert(schema.user)
        .values({ id: userId, name: "OCR Test", email: `${userId}@example.test` });
      await getOrCreateConversation(userId, source);
      await db.insert(schema.attachment).values({
        id: fileId,
        userId,
        draftConversationId: source,
        filename: "scan.pdf",
        mediaType: "application/pdf",
        size: 8,
        bytes: Buffer.from("original"),
        providerFileId: "provider-file-id",
        credentialHash: "mock-key",
      });
      const recognize = (user: string, conversation: string) =>
        recognizeChatAttachment(user, conversation, "mock-key", fileId, "text_recognition");
      await expect(recognize(userId, source)).rejects.toThrow("Attachment not found");
      const messageId = await db.transaction(async (tx) => {
        const id = await insertMessage(
          source,
          0,
          { role: "user", content: "Extract the table", timestamp: 1 },
          randomUUID(),
          tx,
        );
        await linkMessageAttachments(tx, id, [fileId]);
        return id;
      });
      await expect(recognize(other, source)).rejects.toThrow("Attachment not found");
      await expect(recognize(userId, randomUUID())).rejects.toThrow("Attachment not found");
      expect(fetch).not.toHaveBeenCalled();

      const fork = await forkConversation(userId, source, messageId);
      expect(await Promise.all([recognize(userId, source), recognize(userId, fork)])).toEqual([
        pages,
        pages,
      ]);
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(
        recognizeChatAttachment(userId, source, "mock-key", fileId, "rich_layout_recognition"),
      ).resolves.toEqual(pages);
      expect(fetch).toHaveBeenCalledTimes(2);

      const assistant = await insertMessage(source, 1, {
        role: "assistant",
        api: "openai-completions",
        provider: "deepseek",
        model: "deepseek-flash",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        content: [
          {
            type: "toolCall",
            name: "export_file",
            id: "export",
            arguments: { path: "result.csv" },
          },
        ],
        stopReason: "toolUse",
        timestamp: 2,
      });
      await insertMessage(source, 2, {
        role: "toolResult",
        toolName: "export_file",
        toolCallId: "export",
        content: [],
        details: { download: { id: exportId, filename: "result.csv" } },
        isError: false,
        timestamp: 3,
      });
      await expect(findWorkspaceDownload(other, source, exportId)).resolves.toBeNull();
      await expect(findWorkspaceDownload(userId, fork, exportId)).resolves.toBeNull();
      await expect(findWorkspaceDownload(userId, source, exportId)).resolves.toBe("result.csv");
      const exportedFork = await forkConversation(userId, source, assistant);
      await expect(findWorkspaceDownload(userId, exportedFork, exportId)).resolves.toBe(
        "result.csv",
      );
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, userId));
      await db.$client.end();
      vi.unstubAllGlobals();
    }
  },
);

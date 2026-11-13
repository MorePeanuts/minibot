import { randomUUID } from "node:crypto";
import { createDb, eq, schema } from "@minibot/db";
import { expect, it, vi } from "vitest";
import {
  findDownload,
  getDraftAttachments,
  linkMessageAttachments,
  uploadDocument,
} from "./attachments";
import {
  deleteConversation,
  forkConversation,
  getOrCreateConversation,
  insertMessage,
  listMessagesWithAttachments,
} from "./conversations";

vi.mock("server-only", () => ({}));
vi.mock("../db", () => ({
  db: process.env.ATTACHMENT_TEST_DATABASE_URL
    ? createDb(process.env.ATTACHMENT_TEST_DATABASE_URL)
    : undefined,
}));
vi.mock("../sandbox", () => ({
  sandboxManager: { copyWorkspace: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
}));
vi.mock("./settings", () => ({
  getAgentSettings: vi.fn(async () => ({ apiKey: "mock-key" })),
}));

it.skipIf(!process.env.ATTACHMENT_TEST_DATABASE_URL)(
  "limits draft and download access and preserves forked originals until their last reference is removed",
  async () => {
    const { db } = await import("../db");
    const userId = randomUUID();
    const other = randomUUID();
    const source = randomUUID();
    const removed: string[] = [];
    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        removed.push(String(input));
        return Response.json({ deleted: true });
      }
      return Response.json({ id: "file-api-fixture" });
    });
    vi.stubGlobal("fetch", fakeFetch);

    try {
      await db
        .insert(schema.user)
        .values({ id: userId, name: "Attachment Test", email: `${userId}@example.test` });
      await getOrCreateConversation(userId, source);
      const file = await uploadDocument(
        userId,
        source,
        "mock-key",
        new File(["original"], "file.txt"),
        false,
      );
      expect(await getDraftAttachments(db, other, source, [file.id])).toEqual([]);
      expect(await getDraftAttachments(db, userId, randomUUID(), [file.id])).toEqual([]);
      expect(await findDownload(userId, source, file.id)).toBeNull();
      const messageId = await db.transaction(async (tx) => {
        expect(await getDraftAttachments(tx, userId, source, [file.id])).toHaveLength(1);
        const id = await insertMessage(
          source,
          0,
          { role: "user", content: "Read it", timestamp: 1 },
          randomUUID(),
          tx,
        );
        await linkMessageAttachments(tx, id, [file.id]);
        return id;
      });
      expect(await getDraftAttachments(db, userId, source, [file.id])).toEqual([]);
      expect(await findDownload(other, source, file.id)).toBeNull();
      expect((await findDownload(userId, source, file.id))?.bytes.toString()).toBe("original");

      const fork = await forkConversation(userId, source, messageId);
      expect((await listMessagesWithAttachments(fork))[0]?.attachments?.[0]?.id).toBe(file.id);
      await deleteConversation(userId, source);
      expect(removed).toEqual([]);
      expect(await findDownload(userId, source, file.id)).toBeNull();
      expect((await findDownload(userId, fork, file.id))?.bytes.toString()).toBe("original");

      await deleteConversation(userId, fork);
      expect(removed).toEqual(["https://api.deepseek.com/files/file-api-fixture"]);
      expect(
        await db.select().from(schema.attachment).where(eq(schema.attachment.id, file.id)),
      ).toEqual([]);
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, userId));
      await db.$client.end();
      vi.unstubAllGlobals();
    }
  },
);

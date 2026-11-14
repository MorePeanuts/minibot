import { randomUUID } from "node:crypto";
import { createDb, eq, schema } from "@minibot/db";
import { POST } from "@/app/api/attachments/route";
import { GET } from "@/app/api/attachments/[id]/route";
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
vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("x-test-user");
        return id ? { user: { id } } : null;
      },
    },
  },
}));
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
      const form = init?.body as FormData;
      const original = form.get("file") as File;
      expect(form.get("purpose")).toBe(
        original.name === "file.pdf" ? "rich_layout_recognition" : "user_data",
      );
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
        new File(["original"], "file.pdf", { type: "application/pdf" }),
      );
      expect(await getDraftAttachments(db, other, source, [file.id])).toEqual([]);
      expect(await getDraftAttachments(db, userId, randomUUID(), [file.id])).toEqual([]);
      expect(await findDownload(userId, source, file.id)).toBeNull();
      await db.transaction(async (tx) => {
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

      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=",
        "base64",
      );
      const requestUpload = (body: BodyInit) =>
        POST(
          new Request(`http://localhost/api/attachments?conversationId=${source}&kind=image`, {
            method: "POST",
            headers: { "x-test-user": userId, "content-type": "image/svg+xml" },
            body,
          }),
        );
      const calls = fakeFetch.mock.calls.length;
      expect((await requestUpload('<svg xmlns="http://www.w3.org/2000/svg"/>')).status).toBe(400);
      expect(fakeFetch.mock.calls).toHaveLength(calls);
      const upload = await requestUpload(new Uint8Array(png));
      expect(upload.status).toBe(201);
      const image = await upload.json();
      expect(image).toMatchObject({ filename: "Screenshot.png", mediaType: "image/png" });
      const form = fakeFetch.mock.lastCall?.[1]?.body as FormData;
      expect(form.get("purpose")).toBe("user_data");
      expect(form.get("file")).toMatchObject({ type: "image/png" });

      const requestFile = (id: string, conversationId: string, preview: boolean, user?: string) =>
        GET(
          new Request(
            `http://localhost/api/attachments/${id}?conversationId=${conversationId}&preview=${Number(preview)}`,
            {
              headers: user ? { "x-test-user": user } : undefined,
            },
          ),
          { params: Promise.resolve({ id }) },
        );
      expect((await requestFile(image.id, source, true)).status).toBe(401);
      expect((await requestFile(image.id, source, true, other)).status).toBe(404);
      expect((await requestFile(image.id, randomUUID(), true, userId)).status).toBe(404);
      expect((await requestFile(image.id, source, false, userId)).status).toBe(404);
      expect((await requestFile(file.id, source, true, userId)).status).toBe(404);
      const preview = await requestFile(image.id, source, true, userId);
      expect(preview.status).toBe(200);
      expect(preview.headers.get("content-type")).toBe("image/png");
      expect(preview.headers.get("content-disposition")).toMatch(/^inline/);
      expect(preview.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
      const imageMessage = await db.transaction(async (tx) => {
        const id = await insertMessage(
          source,
          1,
          { role: "user", content: "Describe this", timestamp: 2 },
          randomUUID(),
          tx,
        );
        await linkMessageAttachments(tx, id, [image.id]);
        return id;
      });

      const fork = await forkConversation(userId, source, imageMessage);
      expect((await listMessagesWithAttachments(fork))[0]?.attachments?.[0]?.id).toBe(file.id);
      expect((await listMessagesWithAttachments(fork))[1]?.attachments).toMatchObject([image]);
      expect((await requestFile(image.id, fork, true, userId)).status).toBe(200);
      const original = await requestFile(image.id, fork, false, userId);
      expect(original.headers.get("content-disposition")).toMatch(/^attachment/);
      expect(Buffer.from(await original.arrayBuffer())).toEqual(png);
      await deleteConversation(userId, source);
      expect(removed).toEqual([]);
      expect(await findDownload(userId, source, file.id)).toBeNull();
      expect((await findDownload(userId, fork, file.id))?.bytes.toString()).toBe("original");

      await deleteConversation(userId, fork);
      expect(removed).toHaveLength(2);
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

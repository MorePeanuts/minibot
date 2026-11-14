import { randomUUID } from "node:crypto";
import { createDb, eq, schema } from "@minibot/db";
import { runChat } from "@/server/chat/run-chat";
import type { ChatModelConfig } from "@minibot/agent";
import { getAgentSettings } from "./settings";
import { POST } from "@/app/api/attachments/route";
import { GET } from "@/app/api/attachments/[id]/route";
import { afterAll, expect, it, vi } from "vitest";
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
  listMessages,
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
  getAgentSettings: vi.fn(async () => ({
    apiKey: "mock-key",
    chatProvider: "deepseek",
    chat: { provider: "deepseek", apiKey: "mock-key", modelId: "deepseek-flash" },
    thinkingLevel: "off",
  })),
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
      vi.unstubAllGlobals();
    }
  },
);

afterAll(async () => {
  if (process.env.ATTACHMENT_TEST_DATABASE_URL) {
    const { db } = await import("../db");
    await db.$client.end();
  }
});

it.skipIf(!process.env.ATTACHMENT_TEST_DATABASE_URL)(
  "passes authorized old and local originals to Responses across fork and regenerate and rejects oversize history",
  async () => {
    const { db } = await import("../db");
    const userId = randomUUID();
    const foreign = randomUUID();
    const source = randomUUID();
    const chat = {
      provider: "responses",
      modelId: "relay/fixture",
      baseUrl: "https://relay.invalid/v1",
      apiKey: "relay-test",
      reasoning: false,
    } satisfies ChatModelConfig;
    const settings = vi.mocked(getAgentSettings);
    settings.mockResolvedValue({
      chat,
      apiKey: null,
      chatProvider: "responses",
      thinkingLevel: "off",
    });
    const outgoing: Record<string, unknown>[] = [];
    const relay = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${chat.baseUrl}/responses`);
      outgoing.push(JSON.parse(String(init?.body)));
      const item = {
        type: "message",
        role: "assistant",
        id: "msg_fixture",
        status: "completed",
        content: [{ type: "output_text", text: "I read the files.", annotations: [] }],
      };
      return new Response(
        [
          { type: "response.created", response: { id: "resp_fixture" } },
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_text.delta", output_index: 0, delta: "I read the files." },
          { type: "response.output_item.done", output_index: 0, item },
          {
            type: "response.completed",
            response: { id: "resp_fixture", status: "completed", output: [item] },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    vi.stubGlobal("fetch", relay);
    const signal = new AbortController().signal;
    try {
      await db.insert(schema.user).values(
        [userId, foreign].map((id) => ({
          id,
          name: "Relay Attachment Test",
          email: `${id}@example.test`,
        })),
      );
      await getOrCreateConversation(userId, source);
      const upload = await POST(
        new Request(
          `http://localhost/api/attachments?conversationId=${source}&filename=local.pdf`,
          { method: "POST", headers: { "x-test-user": userId }, body: "local original" },
        ),
      );
      expect(upload.status).toBe(201);
      const local = await upload.json();
      expect(relay).not.toHaveBeenCalled();

      const [old] = await db
        .insert(schema.attachment)
        .values({
          userId,
          filename: "old.pdf",
          mediaType: "application/octet-stream",
          size: 12,
          bytes: Buffer.from("old original"),
          providerFileId: "file-old",
          credentialHash: "old-deepseek-credential",
        })
        .returning({ id: schema.attachment.id });
      const oldTurn = await insertMessage(source, 0, {
        role: "user",
        content: "Read old PDF",
        timestamp: 1,
      });
      await linkMessageAttachments(db, oldTurn, [old!.id]);

      const submit = {
        trigger: "submit-message" as const,
        conversationId: source,
        message: { id: randomUUID(), text: "Read both PDFs", attachmentIds: [local.id] },
      };
      await expect(runChat(foreign, submit, signal)).rejects.toThrow("Conversation not found");
      await db
        .update(schema.attachment)
        .set({ size: 50_000_000 })
        .where(eq(schema.attachment.id, local.id));
      await expect(runChat(userId, submit, signal)).rejects.toThrow("50 MB");
      expect(await listMessages(source)).toHaveLength(1);
      expect(await getDraftAttachments(db, userId, source, [local.id])).toHaveLength(1);
      expect(relay).not.toHaveBeenCalled();
      await db
        .update(schema.attachment)
        .set({ size: 14 })
        .where(eq(schema.attachment.id, local.id));

      const stream = await runChat(userId, submit, signal);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(JSON.stringify(chunks)).toContain("I read the files.");
      const fork = await forkConversation(userId, source, submit.message.id);
      const regenerated = await runChat(
        userId,
        { trigger: "regenerate-message", conversationId: fork },
        signal,
      );
      const regeneratedChunks = [];
      for await (const chunk of regenerated) regeneratedChunks.push(chunk);
      expect(JSON.stringify(regeneratedChunks)).toContain("I read the files.");
      expect(outgoing).toHaveLength(2);
      for (const payload of outgoing) {
        const request = JSON.stringify(payload);
        expect(request).toContain(
          `data:application/pdf;base64,${Buffer.from("old original").toString("base64")}`,
        );
        expect(request).toContain(
          `data:application/pdf;base64,${Buffer.from("local original").toString("base64")}`,
        );
        expect(request).toContain('"name":"read_attachment"');
        expect(request).not.toContain('"name":"ocr_document"');
        expect(request).not.toContain("file-old");
      }
      expect(JSON.stringify(await listMessages(fork))).not.toContain("base64");
      settings.mockResolvedValue({
        chat: { provider: "deepseek", apiKey: "mock-key", modelId: "deepseek-flash" },
        apiKey: "mock-key",
        chatProvider: "deepseek",
        thinkingLevel: "off",
      });
      const before = await listMessages(fork);
      await expect(
        runChat(userId, { trigger: "regenerate-message", conversationId: fork }, signal),
      ).rejects.toThrow("Switch back to Responses");
      expect(await listMessages(fork)).toEqual(before);
    } finally {
      settings.mockReset();
      await db.delete(schema.user).where(eq(schema.user.id, userId));
      await db.delete(schema.user).where(eq(schema.user.id, foreign));
      vi.unstubAllGlobals();
    }
  },
);

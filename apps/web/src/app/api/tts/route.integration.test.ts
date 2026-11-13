import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@minibot/agent";
import { createDb, eq, schema } from "@minibot/db";
import { expect, it, vi } from "vitest";
import {
  forkConversation,
  getOrCreateConversation,
  insertMessage,
  listMessages,
} from "@/server/services/conversations";
import { POST } from "./route";
import { encodeVoiceWav } from "@/lib/chat/voice";

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: ({ headers }: { headers: Headers }) => {
        const id = headers.get("test-user");
        return id ? { user: { id } } : null;
      },
    },
  },
}));
vi.mock("@/server/db", () => ({
  db: process.env.ATTACHMENT_TEST_DATABASE_URL
    ? createDb(process.env.ATTACHMENT_TEST_DATABASE_URL)
    : undefined,
}));
vi.mock("@/server/services/settings", () => ({
  getAgentSettings: async () => ({ apiKey: "mock-key" }),
}));
vi.mock("@/server/sandbox", () => ({
  sandboxManager: { copyWorkspace: async () => {} },
}));

function assistant(content: Extract<AgentMessage, { role: "assistant" }>["content"]): AgentMessage {
  return {
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
    content,
    stopReason: "stop",
    timestamp: 1,
  };
}

it.skipIf(!process.env.ATTACHMENT_TEST_DATABASE_URL)(
  "speaks only the authorized assistant turn text and rejects invalid responses",
  async () => {
    const { db } = await import("@/server/db");
    const user = randomUUID();
    const source = randomUUID();
    const wav = Buffer.from(encodeVoiceWav(new Int16Array(32)));
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      return new Response(wav, { headers: { "Content-Type": "audio/wav" } });
    });
    vi.stubGlobal("fetch", fetch);

    function speak(id: string, messageId: string, userId: string | null = user) {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (userId) headers.set("test-user", userId);
      const url = new URL("http://localhost/api/tts");
      url.search = new URLSearchParams({ conversationId: id, messageId }).toString();
      return POST(new Request(url, { method: "POST", headers, body: '{"text":"forged"}' }));
    }

    try {
      await db
        .insert(schema.user)
        .values({ id: user, name: "TTS Test", email: `${user}@example.test` });
      await getOrCreateConversation(user, source);
      const prompt = await insertMessage(source, 0, {
        role: "user",
        content: "Prompt",
        timestamp: 1,
      });
      const reply = await insertMessage(
        source,
        1,
        assistant([
          { type: "thinking", thinking: "Private reasoning" },
          { type: "text", text: "First paragraph." },
          { type: "toolCall", name: "bash", id: "call", arguments: { command: "hidden" } },
        ]),
      );
      await insertMessage(source, 2, {
        role: "toolResult",
        toolName: "bash",
        toolCallId: "call",
        content: [{ type: "text", text: "Private result" }],
        details: { debug: "secret" },
        isError: false,
        timestamp: 1,
      });
      const step = await insertMessage(
        source,
        3,
        assistant([{ type: "text", text: "**Second paragraph.**" }]),
      );
      await insertMessage(source, 4, { role: "user", content: "Another prompt", timestamp: 1 });
      const tooLong = await insertMessage(
        source,
        5,
        assistant([{ type: "text", text: "汉".repeat(5001) }]),
      );
      const fork = await forkConversation(user, source, reply);
      const forkReply = (await listMessages(fork))[1]!.id;

      expect((await speak(source, reply, null)).status).toBe(401);
      expect((await speak(source, reply, randomUUID())).status).toBe(404);
      expect((await speak(source, forkReply)).status).toBe(404);
      expect((await speak(source, prompt)).status).toBe(404);
      expect((await speak(source, step)).status).toBe(404);
      expect((await speak(source, tooLong)).status).toBe(413);
      expect(fetch).not.toHaveBeenCalled();

      for (const [conversationId, messageId] of [
        [source, reply],
        [fork, forkReply],
      ] as const) {
        const result = await speak(conversationId, messageId);
        expect(result.status).toBe(200);
        expect(result.headers.get("Cache-Control")).toBe("private, no-store");
        expect(Buffer.from(await result.arrayBuffer())).toEqual(wav);
        expect(fetch).toHaveBeenLastCalledWith(
          "https://api.deepseek.com/v1/tools/tts",
          expect.objectContaining({
            headers: { Authorization: "Bearer mock-key", "Content-Type": "application/json" },
            body: JSON.stringify({
              text: "First paragraph.\n\n**Second paragraph.**",
              voice_id: "stella",
              format: "wav",
              filter_markdown: true,
            }),
          }),
        );
      }

      fetch.mockResolvedValueOnce(new Response(null, { status: 402 }));
      const error = await speak(source, reply);
      expect(error.status).toBe(502);
      expect(await error.json()).toEqual({ error: "DeepSeek account has insufficient balance." });

      const truncated = wav.subarray(0, wav.length - 2);
      fetch.mockResolvedValueOnce(
        new Response(truncated, { headers: { "Content-Type": "audio/wav" } }),
      );
      expect((await speak(source, reply)).status).toBe(502);
    } finally {
      await db.delete(schema.user).where(eq(schema.user.id, user));
      await db.$client.end();
      vi.unstubAllGlobals();
    }
  },
);

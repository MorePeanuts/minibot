import "server-only";
import { randomUUID } from "node:crypto";
import { createMiniBotAgent, generateTitle } from "@minibot/agent";
import { createUIMessageStream } from "ai";
import { z } from "zod";
import type { MiniBotUIMessage } from "@/lib/chat/types";
import { contentToText } from "@/lib/chat/ui-messages";
import { sandboxManager } from "../sandbox";
import {
  deleteMessagesFrom,
  getConversation,
  getOrCreateConversation,
  insertMessage,
  listMessages,
  NotFoundError,
  renameConversation,
  touchConversation,
} from "../services/conversations";
import { getAgentSettings } from "../services/settings";
import { createEventMapper } from "./event-mapper";

export const chatRequestSchema = z.discriminatedUnion("trigger", [
  z.object({
    trigger: z.literal("submit-message"),
    conversationId: z.uuid(),
    message: z.object({ id: z.uuid(), text: z.string().trim().min(1).max(100_000) }),
  }),
  z.object({
    trigger: z.literal("regenerate-message"),
    conversationId: z.uuid(),
    /** UI message to regenerate; defaults to the last assistant turn. */
    messageId: z.uuid().optional(),
  }),
]);
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

// One active run per conversation (kept on globalThis to survive dev hot reloads).
const globalForRuns = globalThis as unknown as { activeChatRuns?: Set<string> };
const activeRuns = (globalForRuns.activeChatRuns ??= new Set());

/** Prepares the persisted history for this request and returns the next free `seq`. */
async function prepareHistory(userId: string, request: ChatRequest) {
  const { conversationId } = request;

  if (request.trigger === "submit-message") {
    const conversation = await getOrCreateConversation(userId, conversationId);
    const rows = await listMessages(conversationId);
    const seq = (rows.at(-1)?.seq ?? -1) + 1;
    const userMessage = {
      role: "user" as const,
      content: request.message.text,
      timestamp: Date.now(),
    };
    await insertMessage(conversationId, seq, userMessage, request.message.id);
    rows.push({ id: request.message.id, seq, data: userMessage });
    return { conversation, rows };
  }

  const conversation = await getConversation(userId, conversationId);
  if (!conversation) throw new NotFoundError();
  const rows = await listMessages(conversationId);
  // Mirror useChat's regenerate(): drop the targeted assistant turn (or everything after
  // a targeted user message) and generate again from the preceding user message.
  let cut = request.messageId
    ? rows.findIndex((r) => r.id === request.messageId)
    : rows.findLastIndex((r) => r.data.role === "user") + 1;
  if (cut === -1) throw new NotFoundError("Message");
  if (rows[cut]?.data.role === "user") cut++;
  if (cut < rows.length) await deleteMessagesFrom(conversationId, rows[cut]!.seq);
  return { conversation, rows: rows.slice(0, cut) };
}

/**
 * Runs one agent turn and returns it as an AI SDK UI message stream.
 * Every finalized message is persisted as soon as the agent emits it, so partial
 * progress survives aborts and crashes.
 */
export async function runChat(userId: string, request: ChatRequest, signal: AbortSignal) {
  const settings = await getAgentSettings(userId);
  if (!settings.apiKey) {
    throw new ChatError("Add your DeepSeek API key in Settings to start chatting.", 400);
  }
  const { conversationId } = request;
  if (activeRuns.has(conversationId)) {
    throw new ChatError("A response is already being generated for this chat.", 409);
  }
  activeRuns.add(conversationId);

  try {
    const { conversation, rows } = await prepareHistory(userId, request);
    const last = rows.at(-1);
    if (last?.data.role !== "user") throw new ChatError("Nothing to respond to.", 400);

    const userText = contentToText(last.data.content);
    const apiKey = settings.apiKey;
    const isFirstTurn = rows.length === 1 && conversation.title === "New chat";
    const agent = createMiniBotAgent({
      apiKey,
      modelId: settings.model,
      thinkingLevel: settings.thinkingLevel,
      history: rows.map((r) => r.data),
      getSandbox: () => sandboxManager.acquire(conversationId),
      sessionId: conversationId,
    });

    let nextSeq = last.seq + 1;
    // The first persisted assistant row gets the id of the streamed UI message,
    // so fork / regenerate can reference it without a reload.
    const assistantMessageId = randomUUID();
    let assistantIdUsed = false;

    return createUIMessageStream<MiniBotUIMessage>({
      execute: async ({ writer }) => {
        try {
          const titleTask = isFirstTurn
            ? generateTitle(apiKey, userText)
                .then((title) => renameConversation(userId, conversationId, title))
                .catch((error) => console.error("title generation failed", error))
            : undefined;

          writer.write({ type: "start", messageId: assistantMessageId });
          const map = createEventMapper((chunk) => writer.write(chunk));

          agent.subscribe(async (event) => {
            map(event);
            if (event.type !== "message_end") return;
            const { message } = event;
            if (message.role !== "assistant" && message.role !== "toolResult") return;
            const id =
              message.role === "assistant" && !assistantIdUsed
                ? ((assistantIdUsed = true), assistantMessageId)
                : randomUUID();
            await insertMessage(conversationId, nextSeq++, message, id);
          });

          const abort = () => agent.abort();
          signal.addEventListener("abort", abort, { once: true });
          try {
            await agent.continue();
          } finally {
            signal.removeEventListener("abort", abort);
          }

          await titleTask;
          await touchConversation(conversationId);
          writer.write({ type: "finish" });
        } finally {
          activeRuns.delete(conversationId);
        }
      },
      onError: (error) => {
        console.error("chat run failed", error);
        return error instanceof Error ? error.message : "Unexpected error";
      },
    });
  } catch (error) {
    activeRuns.delete(conversationId);
    throw error;
  }
}

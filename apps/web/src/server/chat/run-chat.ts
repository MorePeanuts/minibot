import "server-only";
import { randomUUID } from "node:crypto";
import { recognizeChatAttachment, resolveChatAttachment } from "@/server/services/ocr";
import { createMiniBotAgent, generateTitle, type ChatModelConfig } from "@minibot/agent";
import { createUIMessageStream } from "ai";
import { z } from "zod";
import type { MiniBotUIMessage } from "@/lib/chat/types";
import { isImageMediaType, maxDocuments, maxImages } from "@/lib/chat/attachments";
import { and, eq, schema, type DbExecutor } from "@minibot/db";
import { db } from "../db";
import {
  cleanupProviderFiles,
  deleteUnusedAttachments,
  fileCredentialHash,
  getDraftAttachments,
  linkMessageAttachments,
  listMessageAttachments,
  lockAttachments,
  withFileReferences,
  type ChatAttachment,
} from "../services/attachments";
import { contentToText } from "@/lib/chat/ui-messages";
import { sandboxManager } from "../sandbox";
import {
  deleteMessagesFrom,
  getOrCreateConversation,
  insertMessage,
  listMessages,
  NotFoundError,
  renameConversation,
  touchConversation,
} from "../services/conversations";
import { getAgentSettings } from "../services/settings";
import { loadResponsesAttachments, maxResponsesAttachmentBytes } from "./responses-attachments";
import { createEventMapper } from "./event-mapper";

export const chatRequestSchema = z.discriminatedUnion("trigger", [
  z.object({
    trigger: z.literal("submit-message"),
    conversationId: z.uuid(),
    message: z
      .object({
        id: z.uuid(),
        text: z.string().trim().max(100_000),
        attachmentIds: z
          .array(z.uuid())
          .max(maxDocuments + maxImages)
          .default([])
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .refine(
        ({ text, attachmentIds }) => Boolean(text || attachmentIds.length),
        "Enter a message or attach a file.",
      ),
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

function validateFiles(files: ChatAttachment[], chat: ChatModelConfig) {
  if (chat.provider === "responses") {
    if (files.reduce((sum, file) => sum + file.size, 0) > maxResponsesAttachmentBytes) {
      throw new ChatError(
        "Responses attachments can total up to 50 MB per request, including history. Remove files or start a new chat.",
        400,
      );
    }
    return;
  }
  const images = files.filter((file) => isImageMediaType(file.mediaType)).length;
  if (images > maxImages) {
    throw new ChatError(
      `Attach up to ${maxImages} images per chat request, including history. Start a new chat to attach more.`,
      400,
    );
  }
  if (files.length - images > maxDocuments) {
    throw new ChatError(
      "DeepSeek allows up to 20 documents per chat request, including history. Start a new chat to attach more.",
      400,
    );
  }
  if (files.some((file) => !file.providerFileId)) {
    throw new ChatError(
      "This chat contains files uploaded through the Responses provider. Switch back to Responses or start a new chat and reattach the files.",
      400,
    );
  }
  const credentialHash = fileCredentialHash(chat.apiKey);
  if (files.some((file) => file.credentialHash !== credentialHash)) {
    throw new ChatError(
      "This chat contains files uploaded with a different DeepSeek API key. Restore that key or start a new chat.",
      400,
    );
  }
}

async function prepareHistory(
  userId: string,
  request: ChatRequest,
  chat: ChatModelConfig,
  deepSeekApiKey: string | null,
) {
  const { conversationId } = request;
  if (request.trigger === "submit-message") {
    await getOrCreateConversation(userId, conversationId);
  }
  const prepareOriginals = (tx: DbExecutor, files: Map<string, ChatAttachment[]>) =>
    chat.provider === "responses"
      ? loadResponsesAttachments(tx, userId, [
          ...new Set([...files.values()].flat().map((file) => file.id)),
        ])
      : undefined;
  const result = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(schema.conversation)
      .where(
        and(eq(schema.conversation.id, conversationId), eq(schema.conversation.userId, userId)),
      )
      .for("update");
    if (!conversation) throw new NotFoundError();
    const rows = await listMessages(conversationId, tx);
    if (request.trigger === "submit-message") {
      const { attachmentIds } = request.message;
      const draft = await getDraftAttachments(tx, userId, conversationId, attachmentIds);
      if (draft.length !== attachmentIds.length) throw new NotFoundError("Attachment");
      const files = await listMessageAttachments(
        tx,
        rows.map((row) => row.id),
      );
      validateFiles([...files.values()].flat().concat(draft), chat);
      const seq = (rows.at(-1)?.seq ?? -1) + 1;
      const userMessage = {
        role: "user" as const,
        content: request.message.text,
        timestamp: Date.now(),
      };
      await insertMessage(conversationId, seq, userMessage, request.message.id, tx);
      await linkMessageAttachments(tx, request.message.id, attachmentIds);
      rows.push({ id: request.message.id, seq, data: userMessage });
      if (draft.length) files.set(request.message.id, draft);
      return {
        conversation,
        rows,
        files,
        originals: await prepareOriginals(tx, files),
        unused: [],
      };
    }

    let cut = request.messageId
      ? rows.findIndex((row) => row.id === request.messageId)
      : rows.findLastIndex((row) => row.data.role === "user") + 1;
    if (cut === -1) throw new NotFoundError("Message");
    if (rows[cut]?.data.role === "user") cut++;
    const retained = rows.slice(0, cut);
    if (retained.at(-1)?.data.role !== "user") throw new ChatError("Nothing to respond to.", 400);

    const files = await listMessageAttachments(
      tx,
      retained.map((row) => row.id),
    );
    validateFiles([...files.values()].flat(), chat);
    let unused: Awaited<ReturnType<typeof deleteUnusedAttachments>> = [];
    if (cut < rows.length) {
      const removed = await listMessageAttachments(
        tx,
        rows.slice(cut).map((row) => row.id),
      );
      const ids = [
        ...new Set([...removed.values()].flatMap((entries) => entries.map((file) => file.id))),
      ];
      await lockAttachments(tx, ids);
      await deleteMessagesFrom(conversationId, rows[cut]!.seq, tx);
      unused = await deleteUnusedAttachments(tx, ids);
    }
    return {
      conversation,
      rows: retained,
      files,
      originals: await prepareOriginals(tx, files),
      unused,
    };
  });
  await cleanupProviderFiles(deepSeekApiKey, result.unused);
  return result;
}

/**
 * Runs one agent turn and returns it as an AI SDK UI message stream.
 * Every finalized message is persisted as soon as the agent emits it, so partial
 * progress survives aborts and crashes.
 */
export async function runChat(userId: string, request: ChatRequest, signal: AbortSignal) {
  const settings = await getAgentSettings(userId);
  const { chat, apiKey: deepSeekApiKey } = settings;
  if (!chat) {
    const message =
      settings.chatProvider === "responses"
        ? "Configure your Responses base URL, model ID, and API key in Settings to start chatting."
        : "Add your DeepSeek API key in Settings to start chatting.";
    throw new ChatError(message, 400);
  }
  const { conversationId } = request;
  if (activeRuns.has(conversationId)) {
    throw new ChatError("A response is already being generated for this chat.", 409);
  }
  activeRuns.add(conversationId);

  try {
    const { conversation, rows, files, originals } = await prepareHistory(
      userId,
      request,
      chat,
      deepSeekApiKey,
    );
    const last = rows.at(-1);
    if (last?.data.role !== "user") throw new ChatError("Nothing to respond to.", 400);

    const userText =
      contentToText(last.data.content) ||
      files
        .get(last.id)
        ?.map((file) => file.filename)
        .join(", ") ||
      "";
    const isFirstTurn = rows.length === 1 && conversation.title === "New chat";
    const agent = createMiniBotAgent({
      chat:
        chat.provider === "deepseek" && files.size ? { ...chat, modelId: "deepseek-flash" } : chat,
      deepSeekApiKey,
      thinkingLevel: settings.thinkingLevel,
      history: rows.map(({ id, data }) =>
        data.role === "user" ? withFileReferences(data, files.get(id) ?? []) : data,
      ),
      getSandbox: () => sandboxManager.acquire(conversationId),
      sessionId: conversationId,
      responsesAttachments: originals,
      documents: {
        read: (id) => resolveChatAttachment(userId, conversationId, id),
        recognize: deepSeekApiKey
          ? (id, purpose, toolSignal) =>
              recognizeChatAttachment(
                userId,
                conversationId,
                deepSeekApiKey,
                id,
                purpose,
                toolSignal,
              )
          : undefined,
      },
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
            ? generateTitle(chat, userText)
                .then((title) => renameConversation(userId, conversationId, title))
                .catch((error) => console.error("title generation failed", error))
            : undefined;

          writer.write({ type: "start", messageId: assistantMessageId });
          const map = createEventMapper((chunk) => writer.write(chunk));

          agent.subscribe(async (event) => {
            const isDownload =
              event.type === "message_end" &&
              event.message.role === "toolResult" &&
              event.message.toolName === "export_file" &&
              !event.message.isError;
            if (!isDownload) map(event);
            if (event.type !== "message_end") return;
            const { message } = event;
            if (message.role !== "assistant" && message.role !== "toolResult") return;
            const id =
              message.role === "assistant" && !assistantIdUsed
                ? ((assistantIdUsed = true), assistantMessageId)
                : randomUUID();
            await insertMessage(conversationId, nextSeq++, message, id);
            if (isDownload) map(event);
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

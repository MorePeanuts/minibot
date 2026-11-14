import "server-only";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  type ChatProvider,
  type MiniBotThinkingLevel,
  type ModelId,
} from "@minibot/agent/catalog";
import type { ChatModelConfig } from "@minibot/agent";
import { eq, schema } from "@minibot/db";
import { env } from "@/env";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto";
import { db } from "../db";

const { userSettings } = schema;

export interface PublicSettings {
  chatProvider: ChatProvider;
  responsesBaseUrl: string | null;
  responsesModel: string | null;
  maskedResponsesApiKey: string | null;
  responsesReasoning: boolean;
  hasChatCredentials: boolean;
  hasDeepSeekCredentials: boolean;
  model: ModelId;
  thinkingLevel: MiniBotThinkingLevel;
  /** Masked user key, e.g. "sk-ab…wxyz"; null when not configured. */
  maskedApiKey: string | null;
  /** True when the server provides a fallback DEEPSEEK_API_KEY. */
  hasServerKey: boolean;
}

export interface SettingsUpdate {
  chatProvider?: ChatProvider;
  responsesBaseUrl?: string;
  responsesModel?: string;
  responsesApiKey?: string | null;
  responsesReasoning?: boolean;
  /** `null` removes the stored key, `undefined` leaves it unchanged. */
  apiKey?: string | null;
  model?: ModelId;
  thinkingLevel?: MiniBotThinkingLevel;
}

async function getRow(userId: string) {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row;
}

export async function getPublicSettings(userId: string): Promise<PublicSettings> {
  const row = await getRow(userId);
  const chatProvider = row?.chatProvider ?? "deepseek";
  const hasDeepSeekCredentials = Boolean(row?.encryptedApiKey || env.DEEPSEEK_API_KEY);
  return {
    chatProvider,
    responsesBaseUrl: row?.responsesBaseUrl ?? null,
    responsesModel: row?.responsesModel ?? null,
    maskedResponsesApiKey: row?.encryptedResponsesApiKey
      ? maskSecret(decryptSecret(row.encryptedResponsesApiKey))
      : null,
    responsesReasoning: row?.responsesReasoning ?? false,
    hasDeepSeekCredentials,
    hasChatCredentials:
      chatProvider === "responses"
        ? Boolean(row?.encryptedResponsesApiKey && row.responsesBaseUrl && row.responsesModel)
        : hasDeepSeekCredentials,
    model: (row?.model as ModelId | undefined) ?? DEFAULT_MODEL_ID,
    thinkingLevel:
      (row?.thinkingLevel as MiniBotThinkingLevel | undefined) ?? DEFAULT_THINKING_LEVEL,
    maskedApiKey: row?.encryptedApiKey ? maskSecret(decryptSecret(row.encryptedApiKey)) : null,
    hasServerKey: Boolean(env.DEEPSEEK_API_KEY),
  };
}

/** DeepSeek services retain their own credentials regardless of the selected chat provider. */
export async function getAgentSettings(userId: string) {
  const row = await getRow(userId);
  const apiKey =
    (row?.encryptedApiKey ? decryptSecret(row.encryptedApiKey) : env.DEEPSEEK_API_KEY) ?? null;
  const chatProvider = row?.chatProvider ?? "deepseek";
  let chat: ChatModelConfig | null = null;
  if (chatProvider === "deepseek" && apiKey) {
    chat = { provider: "deepseek", modelId: row?.model ?? DEFAULT_MODEL_ID, apiKey };
  }
  if (
    chatProvider === "responses" &&
    row?.responsesBaseUrl &&
    row.responsesModel &&
    row.encryptedResponsesApiKey
  ) {
    chat = {
      provider: "responses",
      modelId: row.responsesModel,
      baseUrl: row.responsesBaseUrl,
      apiKey: decryptSecret(row.encryptedResponsesApiKey),
      reasoning: row.responsesReasoning,
    };
  }
  return {
    apiKey,
    chatProvider,
    chat,
    thinkingLevel: row?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
  };
}

export async function updateSettings(userId: string, update: SettingsUpdate) {
  const { apiKey, responsesApiKey, ...preferences } = update;
  const values = {
    ...preferences,
    ...(apiKey !== undefined && {
      encryptedApiKey: apiKey ? encryptSecret(apiKey) : null,
    }),
    ...(responsesApiKey !== undefined && {
      encryptedResponsesApiKey: responsesApiKey ? encryptSecret(responsesApiKey) : null,
    }),
  };
  if (!Object.keys(values).length) return;
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values });
}

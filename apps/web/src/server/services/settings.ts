import "server-only";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  type MiniBotThinkingLevel,
  type ModelId,
} from "@minibot/agent/catalog";
import { eq, schema } from "@minibot/db";
import { env } from "@/env";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto";
import { db } from "../db";

const { userSettings } = schema;

export interface PublicSettings {
  model: ModelId;
  thinkingLevel: MiniBotThinkingLevel;
  /** Masked user key, e.g. "sk-ab…wxyz"; null when not configured. */
  maskedApiKey: string | null;
  /** True when the server provides a fallback DEEPSEEK_API_KEY. */
  hasServerKey: boolean;
}

export interface SettingsUpdate {
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
  return {
    model: (row?.model as ModelId | undefined) ?? DEFAULT_MODEL_ID,
    thinkingLevel:
      (row?.thinkingLevel as MiniBotThinkingLevel | undefined) ?? DEFAULT_THINKING_LEVEL,
    maskedApiKey: row?.encryptedApiKey ? maskSecret(decryptSecret(row.encryptedApiKey)) : null,
    hasServerKey: Boolean(env.DEEPSEEK_API_KEY),
  };
}

/** Everything the agent needs to run for this user; `apiKey` is null when none is available. */
export async function getAgentSettings(userId: string) {
  const row = await getRow(userId);
  const apiKey = row?.encryptedApiKey ? decryptSecret(row.encryptedApiKey) : env.DEEPSEEK_API_KEY;
  return {
    apiKey: apiKey ?? null,
    model: row?.model ?? DEFAULT_MODEL_ID,
    thinkingLevel: row?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
  };
}

export async function updateSettings(userId: string, update: SettingsUpdate) {
  const values = {
    ...(update.model && { model: update.model }),
    ...(update.thinkingLevel && { thinkingLevel: update.thinkingLevel }),
    ...(update.apiKey !== undefined && {
      encryptedApiKey: update.apiKey ? encryptSecret(update.apiKey) : null,
    }),
  };
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values });
}

"use server";

import { CHAT_PROVIDERS, SUPPORTED_MODELS, THINKING_LEVELS } from "@minibot/agent/catalog";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/session";
import { updateSettings } from "@/server/services/settings";

const responsesBaseUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((value, ctx) => {
    const url = /^https?:\/\//i.test(value) && URL.canParse(value) ? new URL(value) : null;
    if (
      !url ||
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      value.includes("?") ||
      value.includes("#")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an HTTP(S) base URL without credentials, a query, or a fragment.",
      });
      return z.NEVER;
    }
    const path = url.pathname
      .replace(/\/+$/, "")
      .replace(/\/responses$/, "")
      .replace(/\/+$/, "");
    return url.origin + path;
  });

const settingsSchema = z.object({
  /** undefined = keep, null = remove, string = replace */
  apiKey: z.string().trim().min(10).max(500).nullable().optional(),
  model: z.enum(SUPPORTED_MODELS.map((m) => m.id)).optional(),
  chatProvider: z.enum(CHAT_PROVIDERS).optional(),
  responsesBaseUrl: responsesBaseUrl.optional(),
  responsesModel: z.string().trim().min(1).max(255).optional(),
  responsesReasoning: z.boolean().optional(),
  responsesApiKey: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .regex(/^[!-~]+$/, "Enter a valid API key.")
    .nullable()
    .optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

export type SettingsInput = z.input<typeof settingsSchema>;

export async function updateSettingsAction(input: SettingsInput) {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: z.prettifyError(parsed.error) };
  await updateSettings(user.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

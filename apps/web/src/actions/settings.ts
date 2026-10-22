"use server";

import { SUPPORTED_MODELS, THINKING_LEVELS } from "@minibot/agent/catalog";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/session";
import { updateSettings } from "@/server/services/settings";

const settingsSchema = z.object({
  /** undefined = keep, null = remove, string = replace */
  apiKey: z.string().trim().min(10).max(500).nullable().optional(),
  model: z.enum(SUPPORTED_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
});

export type SettingsInput = z.input<typeof settingsSchema>;

export async function updateSettingsAction(input: SettingsInput) {
  const user = await requireUser();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: z.prettifyError(parsed.error) };
  await updateSettings(user.id, parsed.data as Parameters<typeof updateSettings>[1]);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

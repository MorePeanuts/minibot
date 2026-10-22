/**
 * Dependency-free model catalog. Safe to import from client components
 * (`@minibot/agent/catalog`) without pulling the Node-only agent runtime into the browser.
 */

/** Models exposed in the UI. Pricing, context window etc. come from pi-ai's catalog. */
export const SUPPORTED_MODELS = [
  { id: "deepseek-flash", label: "DeepSeek Flash", description: "Fast & cheap, 1M context" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "Strongest reasoning" },
] as const;

export type ModelId = (typeof SUPPORTED_MODELS)[number]["id"];
export const DEFAULT_MODEL_ID: ModelId = "deepseek-flash";

export const THINKING_LEVELS = ["off", "low", "high", "max"] as const;
export type MiniBotThinkingLevel = (typeof THINKING_LEVELS)[number];
export const DEFAULT_THINKING_LEVEL: MiniBotThinkingLevel = "low";

export function isModelId(value: string): value is ModelId {
  return SUPPORTED_MODELS.some((m) => m.id === value);
}

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { clampThinkingLevel, createModels, type Model, type Api } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  isModelId,
  type MiniBotThinkingLevel,
  THINKING_LEVELS,
} from "./catalog";

export {
  DEFAULT_MODEL_ID,
  DEFAULT_THINKING_LEVEL,
  isModelId,
  SUPPORTED_MODELS,
  THINKING_LEVELS,
  type MiniBotThinkingLevel,
  type ModelId,
} from "./catalog";

/** A single shared Models registry containing only the DeepSeek provider (tree-shaken). */
export const models = createModels();
models.setProvider(deepseekProvider());

export function resolveModel(modelId: string): Model<Api> {
  const model = models.getModel("deepseek", isModelId(modelId) ? modelId : DEFAULT_MODEL_ID);
  if (!model) throw new Error(`Model "${modelId}" is not available`);
  return model;
}

/** Maps a requested level to the closest one the model actually supports. */
export function resolveThinkingLevel(model: Model<Api>, level: string): ThinkingLevel {
  if (level === "off") return "off";
  const requested = (THINKING_LEVELS as readonly string[]).includes(level)
    ? (level as MiniBotThinkingLevel)
    : DEFAULT_THINKING_LEVEL;
  return clampThinkingLevel(model, requested as Exclude<MiniBotThinkingLevel, "off">);
}

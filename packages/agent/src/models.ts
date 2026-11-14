import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  clampThinkingLevel,
  createModels,
  type Model,
  type Api,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createProvider } from "@earendil-works/pi-ai/models";
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

export type ChatModelConfig =
  | { provider: "deepseek"; modelId: string; apiKey: string }
  | { provider: "responses"; modelId: string; baseUrl: string; apiKey: string; reasoning: boolean };

/** The provider registry holds no per-user models or credentials. */
export const models = createModels();
models.setProvider(deepseekProvider());

models.setProvider(
  createProvider({
    id: "openai",
    name: "Custom Responses",
    baseUrl: "https://api.openai.com/v1",
    auth: {
      apiKey: {
        name: "Custom Responses API key",
        resolve: async ({ credential }) =>
          credential?.key ? { auth: { apiKey: credential.key }, source: "request" } : undefined,
      },
    },
    models: [],
    api: openAIResponsesApi(),
  }),
);

export function resolveModel(config: ChatModelConfig): Model<Api> {
  const { modelId } = config;
  if (config.provider === "responses") {
    return {
      id: modelId,
      name: modelId,
      provider: "openai",
      api: "openai-responses",
      baseUrl: config.baseUrl,
      reasoning: config.reasoning,
      thinkingLevelMap: { off: null, max: null },
      compat: { supportsMaxOutputTokens: false },
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
    };
  }
  const model = models.getModel("deepseek", isModelId(modelId) ? modelId : DEFAULT_MODEL_ID);
  if (!model) throw new Error(`Model "${modelId}" is not available`);
  return model;
}

/** Maps a requested level to the closest one the model actually supports. */
export function resolveThinkingLevel(model: Model<Api>, level: string): ThinkingLevel {
  if (!model.reasoning || level === "off") return "off";
  const requested = (THINKING_LEVELS as readonly string[]).includes(level)
    ? (level as MiniBotThinkingLevel)
    : DEFAULT_THINKING_LEVEL;
  return clampThinkingLevel(model, requested as Exclude<MiniBotThinkingLevel, "off">);
}

// A configured relay receives the key and transcript. Do not forward requests via redirects.
export const responsesStreamOptions = {
  cacheRetention: "none",
  fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
} satisfies Pick<SimpleStreamOptions, "cacheRetention" | "fetch">;

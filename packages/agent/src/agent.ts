import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { addFileContent, type FileUserMessage } from "./file-content";
import { models, resolveModel, resolveThinkingLevel } from "./models";
import { buildSystemPrompt, SANDBOX_WORKDIR } from "./prompt";
import { DeepSeekToolsClient } from "./tools/deepseek-search";
import { createSandboxTools, type SandboxProvider } from "./tools/sandbox";
import { createWebFetchTool, createWebSearchTool } from "./tools/web";

export interface CreateMiniBotAgentOptions {
  /** The user's DeepSeek API key (used for both chat and Search/Fetch). */
  apiKey: string;
  modelId: string;
  thinkingLevel: string;
  /** Prior conversation (user / assistant / toolResult messages). */
  history: AgentMessage[];
  getSandbox: SandboxProvider;
  /** Forwarded to the provider for prompt-cache affinity. */
  sessionId?: string;
}

/** Assembles a ready-to-run pi Agent with MiniBot's model, prompt and tools. */
export function createMiniBotAgent(options: CreateMiniBotAgentOptions): Agent {
  const model = resolveModel(options.modelId);
  const deepseekTools = new DeepSeekToolsClient(options.apiKey);

  return new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(),
      model,
      thinkingLevel: resolveThinkingLevel(model, options.thinkingLevel),
      tools: [
        createWebSearchTool(deepseekTools),
        createWebFetchTool(deepseekTools),
        ...createSandboxTools(SANDBOX_WORKDIR, options.getSandbox),
      ],
      messages: options.history,
    },
    streamFn: (model, context, streamOptions) => {
      const hasFiles = context.messages.some(
        (message) =>
          message.role === "user" && (message as FileUserMessage).providerFileIds?.length,
      );
      if (!hasFiles) return models.streamSimple(model, context, streamOptions);
      return models.streamSimple(model, context, {
        ...streamOptions,
        onPayload: async (payload, providerModel) => {
          const original = await streamOptions?.onPayload?.(payload, providerModel);
          return addFileContent(original ?? payload, context);
        },
      });
    },
    getApiKey: () => options.apiKey,
    sessionId: options.sessionId,
    identity: { attribution: { name: "MiniBot", url: "https://github.com/minibot" } },
  });
}

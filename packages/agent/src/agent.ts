import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { prepareFileContent, type ResponsesAttachment } from "./file-content";
import {
  models,
  resolveModel,
  resolveThinkingLevel,
  responsesStreamOptions,
  type ChatModelConfig,
} from "./models";
import { buildSystemPrompt, SANDBOX_WORKDIR } from "./prompt";
import { createDocumentTools, createExportFileTool, type DocumentAccess } from "./tools/documents";
import { DeepSeekToolsClient } from "./tools/deepseek-search";
import { createSandboxTools, type SandboxProvider } from "./tools/sandbox";
import { createWebFetchTool, createWebSearchTool } from "./tools/web";

export interface CreateMiniBotAgentOptions {
  chat: ChatModelConfig;
  /** Independent key for DeepSeek web tools. */
  deepSeekApiKey?: string | null;
  thinkingLevel: string;
  /** Prior conversation (user / assistant / toolResult messages). */
  history: AgentMessage[];
  getSandbox: SandboxProvider;
  documents?: DocumentAccess;
  responsesAttachments?: ReadonlyMap<string, ResponsesAttachment>;
  /** Forwarded to the provider for prompt-cache affinity. */
  sessionId?: string;
}

/** Assembles a ready-to-run pi Agent with MiniBot's model, prompt and tools. */
export function createMiniBotAgent(options: CreateMiniBotAgentOptions): Agent {
  const model = resolveModel(options.chat);
  const deepseekTools = options.deepSeekApiKey
    ? new DeepSeekToolsClient(options.deepSeekApiKey)
    : undefined;

  return new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(new Date(), Boolean(deepseekTools)),
      model,
      thinkingLevel: resolveThinkingLevel(model, options.thinkingLevel),
      tools: [
        ...(deepseekTools
          ? [createWebSearchTool(deepseekTools), createWebFetchTool(deepseekTools)]
          : []),
        ...createSandboxTools(SANDBOX_WORKDIR, options.getSandbox),
        ...(options.documents ? createDocumentTools(options.getSandbox, options.documents) : []),
        createExportFileTool(options.getSandbox),
      ],
      messages: options.history,
    },
    streamFn: (model, context, streamOptions) => {
      const responses = model.api === "openai-responses";
      const settings = responses ? { ...streamOptions, ...responsesStreamOptions } : streamOptions;
      const files = prepareFileContent(
        context,
        responses ? options.responsesAttachments : undefined,
      );
      if (files.context === context) return models.streamSimple(model, context, settings);
      return models.streamSimple(model, files.context, {
        ...settings,
        onPayload: async (payload, providerModel) => {
          const original = await streamOptions?.onPayload?.(payload, providerModel);
          return files.addToPayload(original ?? payload);
        },
      });
    },
    getApiKey: () => options.chat.apiKey,
    sessionId: options.sessionId,
    identity: { attribution: { name: "MiniBot", url: "https://github.com/minibot" } },
  });
}

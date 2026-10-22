import type { UIMessage } from "ai";

/** Output payload of a tool call as shown in the UI. */
export interface ToolOutput {
  text: string;
  details?: unknown;
}

export type MiniBotDataParts = {
  /** Provider / agent error attached to an assistant turn. */
  error: { message: string };
};

export type MiniBotUIMessage = UIMessage<never, MiniBotDataParts>;

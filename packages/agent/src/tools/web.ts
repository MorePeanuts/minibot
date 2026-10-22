import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { truncateHead } from "@earendil-works/pi-coding-agent";
import type { DeepSeekToolsClient, SearchResult } from "./deepseek-search";

/** Compact result shape kept in tool `details` for the UI (source cards). */
export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  siteName: string | null;
  siteIcon: string | null;
  date: string | null;
}

export interface WebSearchDetails {
  query: string;
  sources: WebSearchSource[];
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) =>
      [
        `[${i + 1}] ${r.title}`,
        `URL: ${r.url}`,
        r.date ? `Published: ${r.date}` : undefined,
        r.summary || r.snippet,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

const webSearchParameters = Type.Object({
  query: Type.String({
    description:
      'Search query (max 128 chars). Supports operators: site:, -site:, "exact phrase", lang:en, after:2025, before:2026-06-01.',
    maxLength: 128,
  }),
  count: Type.Optional(
    Type.Integer({ description: "Number of results (1-20, default 8)", minimum: 1, maximum: 20 }),
  ),
});

export function createWebSearchTool(
  client: DeepSeekToolsClient,
): AgentTool<typeof webSearchParameters, WebSearchDetails> {
  return {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web for up-to-date information. Returns ranked results with URL, date and a summary. " +
      "Use web_fetch to read a full page when the summary is not enough. Cite sources with their URLs.",
    parameters: webSearchParameters,
    executionMode: "parallel",
    async execute(_id, { query, count }, signal) {
      const results = await client.search({ query, count: count ?? 8 }, signal);
      const details: WebSearchDetails = {
        query,
        sources: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          siteName: r.site_name,
          siteIcon: r.site_icon,
          date: r.date,
        })),
      };
      return { content: [{ type: "text", text: formatResults(results) }], details };
    },
  };
}

const webFetchParameters = Type.Object({
  url: Type.String({ description: "HTTP(S) URL of the page to read" }),
});

export function createWebFetchTool(
  client: DeepSeekToolsClient,
): AgentTool<typeof webFetchParameters, { url: string; title: string }> {
  return {
    name: "web_fetch",
    label: "Read web page",
    description: "Fetch a single web page and return its main content as Markdown.",
    parameters: webFetchParameters,
    executionMode: "parallel",
    async execute(_id, { url }, signal) {
      const page = await client.fetchPage(url, signal);
      const truncation = truncateHead(page.content);
      let text = `# ${page.title || url}\n\n${truncation.content}`;
      if (truncation.truncated) text += "\n\n[Content truncated]";
      return { content: [{ type: "text", text }], details: { url, title: page.title } };
    },
  };
}

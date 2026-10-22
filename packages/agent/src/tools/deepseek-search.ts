/**
 * Minimal typed client for DeepSeek's Search & Fetch tool APIs.
 * Docs: https://api-docs.deepseek.com/guides/search/
 */

const BASE_URL = "https://api.deepseek.com/v1/tools";

export interface SearchResult {
  rerank_score: number;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  site_icon: string | null;
  date: string | null;
  authority: number;
}

export interface SearchRequest {
  query: string;
  count?: number;
  need_content?: boolean;
}

export interface FetchResponse {
  title: string;
  content: string;
}

export class DeepSeekToolsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeepSeekToolsError";
  }
}

export class DeepSeekToolsClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]> {
    const body = await this.post<{ results: SearchResult[] }>("/search", request, signal);
    return body.results;
  }

  fetchPage(url: string, signal?: AbortSignal): Promise<FetchResponse> {
    return this.post<FetchResponse>("/fetch", { url }, signal);
  }

  private async post<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        message?: string;
      } | null;
      const detail = error?.error?.message ?? error?.message ?? response.statusText;
      throw new DeepSeekToolsError(
        response.status,
        `DeepSeek ${path} failed (${response.status}): ${detail}`,
      );
    }
    return (await response.json()) as T;
  }
}

export type DeepSeekFilePurpose = "text_recognition" | "rich_layout_recognition" | "user_data";

export class DeepSeekFileError extends Error {
  constructor(readonly status: number) {
    super(`DeepSeek Files API returned ${status}.`);
  }
}

const filesUrl = "https://api.deepseek.com/files";

export async function uploadDeepSeekFile(apiKey: string, file: File, purpose: DeepSeekFilePurpose) {
  const body = new FormData();
  body.append("purpose", purpose);
  body.append("file", file);
  const response = await fetch(filesUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
    signal: AbortSignal.timeout(250_000),
  });
  if (!response.ok) throw new DeepSeekFileError(response.status);
  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== "string" || !result.id) throw new DeepSeekFileError(502);
  return result.id;
}

export async function deleteDeepSeekFile(apiKey: string, fileId: string) {
  const response = await fetch(`${filesUrl}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) throw new DeepSeekFileError(response.status);
}

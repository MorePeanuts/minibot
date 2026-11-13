export const downloadLimitBytes = 20 * 1024 * 1024;

export function workspaceDownloadPath(workdir: string, id: string) {
  return `${workdir}/.minibot-downloads/${id}`;
}

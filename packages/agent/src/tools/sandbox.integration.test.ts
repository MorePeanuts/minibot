/**
 * Runs the sandbox tools against a real Docker container.
 * Skipped automatically when Docker or the sandbox image is unavailable.
 */
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Docker, SandboxManager, workspaceDownloadPath } from "@minibot/sandbox";
import { afterAll, describe, expect, it } from "vitest";
import { createDocumentTools, createExportFileTool } from "./documents";
import { createSandboxTools } from "./sandbox";

const IMAGE = process.env.SANDBOX_IMAGE ?? "minibot-sandbox:latest";
const docker = new Docker();
const available = await docker
  .getImage(IMAGE)
  .inspect()
  .then(() => true)
  .catch(() => false);

describe.runIf(available)("sandbox tools (docker)", () => {
  const manager = new SandboxManager(docker, {
    image: IMAGE,
    network: "none",
    memoryMb: 256,
    cpus: 1,
    pidsLimit: 128,
    idleTimeoutMinutes: 5,
  });
  const sessionId = `test-${randomUUID()}`;
  const tools = new Map<string, AgentTool<any>>(
    createSandboxTools("/workspace", () => manager.acquire(sessionId)).map((t) => [t.name, t]),
  );
  const run = async (name: string, args: Record<string, unknown>) => {
    const result = await tools.get(name)!.execute("call", args);
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  };

  afterAll(() => manager.remove(sessionId));

  it("runs bash with streaming output and exit codes", async () => {
    expect(await run("bash", { command: "echo hello && whoami" })).toContain("hello\nagent");
    const failed = await tools.get("bash")!.execute("call", { command: "exit 3" });
    expect(failed.isError).toBe(true);
  }, 60_000);

  it("writes, reads and edits files", async () => {
    await run("write", { path: "src/demo.py", content: "print('one')\n" });
    expect(await run("read", { path: "src/demo.py" })).toContain("print('one')");
    await run("edit", {
      path: "src/demo.py",
      edits: [{ oldText: "one", newText: "two" }],
    });
    expect(await run("bash", { command: "python3 src/demo.py" })).toContain("two");
  }, 60_000);

  it("lists, finds and greps", async () => {
    expect(await run("ls", { path: "." })).toContain("src/");
    expect(await run("find", { pattern: "*.py" })).toContain("src/demo.py");
    expect(await run("grep", { pattern: "print" })).toContain("src/demo.py:1:");
  }, 60_000);

  it("copies originals, stages OCR, processes pages and exports a confined download surviving fork", async () => {
    const sandbox = await manager.acquire(sessionId);
    const getSandbox = async () => sandbox;
    const [copy, ocr] = createDocumentTools(getSandbox, {
      read: async (id) => ({ id, filename: "test.pdf", bytes: Buffer.from("original pdf") }),
      recognize: async () => [
        { index: 0, text: "entry", finish_reason: "stop" },
        { index: 1, text: "partial", finish_reason: "length" },
      ],
    });
    const attachmentId = randomUUID();
    const original = await copy!.execute("copy", { attachmentId });
    const raw = await ocr!.execute("ocr", { attachmentId });
    expect(raw.content[0]).toMatchObject({
      text: expect.stringContaining("1 page(s) were truncated"),
    });
    expect(original.content[0]).toMatchObject({
      text: expect.stringContaining("/workspace/attachments/"),
    });
    await run("write", {
      path: "extract.py",
      content: [
        "import csv, glob, json",
        'with open(glob.glob("ocr/*.json")[0]) as source, open("results.csv", "w") as target:',
        '    pages = json.load(source)["pages"]',
        "    writer = csv.writer(target)",
        '    writer.writerow(["page", "text"])',
        '    writer.writerows((page["index"] + 1, page["text"]) for page in pages)',
      ].join("\n"),
    });
    await run("bash", { command: "python3 extract.py" });
    const exported = await createExportFileTool(getSandbox).execute("export", {
      path: "results.csv",
    });
    const id = exported.details.download.id as string;
    const snapshot = workspaceDownloadPath("/workspace", id);
    await sandbox.writeFile("/workspace/results.csv", "updated later");
    expect((await sandbox.readWorkspaceFile(snapshot, 1024)).toString()).toContain("1,entry");
    await expect(sandbox.readWorkspaceFile(snapshot, 1)).rejects.toThrow(/download limit/);
    await expect(sandbox.readWorkspaceFile("/etc/passwd", 1024)).rejects.toThrow(
      /inside the workspace/,
    );
    await sandbox.exec("ln -sf /etc/passwd file-link && ln -sfn /etc dir-link && mkfifo pipe");
    for (const path of ["file-link", "dir-link/passwd", "pipe", "./../etc/passwd"]) {
      await expect(sandbox.readWorkspaceFile(path, 1024)).rejects.toThrow(/inside the workspace/);
    }
    const forkId = `test-${randomUUID()}`;
    try {
      await manager.copyWorkspace(sessionId, forkId);
      const fork = await manager.acquire(forkId);
      expect((await fork.readWorkspaceFile(snapshot, 1024)).toString()).toContain("2,partial");
    } finally {
      await manager.remove(forkId);
    }
  }, 60_000);

  it("kills long running commands on timeout", async () => {
    const started = Date.now();
    await expect(run("bash", { command: "sleep 30", timeout: 1 })).rejects.toThrow(
      /timed out|timeout/i,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});

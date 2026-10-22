/**
 * Runs the sandbox tools against a real Docker container.
 * Skipped automatically when Docker or the sandbox image is unavailable.
 */
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Docker, SandboxManager } from "@minibot/sandbox";
import { afterAll, describe, expect, it } from "vitest";
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

  it("kills long running commands on timeout", async () => {
    const started = Date.now();
    await expect(run("bash", { command: "sleep 30", timeout: 1 })).rejects.toThrow(
      /timed out|timeout/i,
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});

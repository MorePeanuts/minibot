/**
 * Coding tools (bash, read, write, edit, ls, find, grep) that execute inside an isolated
 * Docker sandbox. We reuse pi-coding-agent's battle-tested tool implementations
 * (argument schemas, truncation, diffing, prompts) and only swap their I/O backend
 * through the pluggable `operations` interfaces.
 */
import path from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createFindTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type FindOperations,
  type LsOperations,
  type ReadOperations,
  truncateHead,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "@minibot/sandbox";

/** Resolves the sandbox lazily so the container is only started when a tool is actually used. */
export type SandboxProvider = () => Promise<Sandbox>;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function exists(sandbox: Sandbox, p: string) {
  return (await sandbox.run(["test", "-e", p])).exitCode === 0;
}

function bashOperations(getSandbox: SandboxProvider): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      const sandbox = await getSandbox();
      return sandbox.exec(command, { cwd, onData, signal, timeoutSeconds: timeout });
    },
  };
}

function readOperations(getSandbox: SandboxProvider): ReadOperations {
  return {
    readFile: async (p) => (await getSandbox()).readFile(p),
    access: async (p) => {
      const { exitCode } = await (await getSandbox()).run(["test", "-r", p]);
      if (exitCode !== 0) throw new Error(`ENOENT: no such file or not readable: ${p}`);
    },
    detectImageMimeType: async (p) => {
      const { stdout } = await (await getSandbox()).run(["file", "--mime-type", "-b", p]);
      const mime = stdout.toString().trim();
      return IMAGE_MIME_TYPES.has(mime) ? mime : null;
    },
  };
}

function writeOperations(getSandbox: SandboxProvider): WriteOperations {
  return {
    writeFile: async (p, content) => (await getSandbox()).writeFile(p, content),
    mkdir: async (dir) => (await getSandbox()).mkdir(dir),
  };
}

function editOperations(getSandbox: SandboxProvider): EditOperations {
  const read = readOperations(getSandbox);
  return {
    readFile: read.readFile,
    writeFile: writeOperations(getSandbox).writeFile,
    access: async (p) => {
      const { exitCode } = await (await getSandbox()).run(["test", "-r", p, "-a", "-w", p]);
      if (exitCode !== 0) throw new Error(`EACCES: file not readable/writable: ${p}`);
    },
  };
}

/**
 * `ls` calls stat() for every entry; to avoid one `docker exec` per entry we list a
 * directory once with `find -printf` and answer subsequent stat() calls from that cache.
 */
function lsOperations(getSandbox: SandboxProvider): LsOperations {
  const knownTypes = new Map<string, "d" | "f">();
  return {
    exists: async (p) => exists(await getSandbox(), p),
    stat: async (p) => {
      let type = knownTypes.get(p);
      if (!type) {
        const { exitCode } = await (await getSandbox()).run(["test", "-d", p]);
        type = exitCode === 0 ? "d" : "f";
      }
      return { isDirectory: () => type === "d" };
    },
    readdir: async (dir) => {
      const sandbox = await getSandbox();
      const { exitCode, stdout, stderr } = await sandbox.run([
        "find",
        dir,
        "-mindepth",
        "1",
        "-maxdepth",
        "1",
        "-printf",
        "%y %f\\n",
      ]);
      if (exitCode !== 0) throw new Error(stderr.toString().trim());
      return stdout
        .toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const name = line.slice(2);
          knownTypes.set(path.posix.join(dir, name), line[0] === "d" ? "d" : "f");
          return name;
        });
    },
  };
}

function findOperations(getSandbox: SandboxProvider): FindOperations {
  return {
    exists: async (p) => exists(await getSandbox(), p),
    glob: async (pattern, cwd, { ignore, limit }) => {
      const args = ["fd", "--glob", "--hidden", "--color=never", "--max-results", String(limit)];
      for (const glob of ignore) args.push("--exclude", glob.replace(/^\*\*\/|\/\*\*$/g, ""));
      // fd matches the file name by default; full-path globs need --full-path.
      if (pattern.includes("/")) args.push("--full-path");
      args.push(pattern, cwd);
      const { stdout } = await (await getSandbox()).run(args);
      return stdout.toString().split("\n").filter(Boolean);
    },
  };
}

const grepParameters = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string" })),
  context: Type.Optional(Type.Integer({ description: "Lines of context around each match" })),
  limit: Type.Optional(Type.Integer({ description: "Maximum matches to return (default 100)" })),
});

/** pi's grep tool always spawns a local ripgrep, so we provide a sandboxed equivalent. */
function createSandboxGrepTool(
  cwd: string,
  getSandbox: SandboxProvider,
): AgentTool<typeof grepParameters> {
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents for a pattern using ripgrep. Returns matching lines with file paths " +
      "and line numbers. Respects .gitignore. Output is truncated to `limit` matches.",
    parameters: grepParameters,
    async execute(_id, params, signal) {
      const limit = Math.max(1, params.limit ?? 100);
      const args = ["rg", "--line-number", "--no-heading", "--color=never", "--max-columns=500"];
      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (params.context && params.context > 0) args.push("--context", String(params.context));
      if (params.glob) args.push("--glob", params.glob);
      args.push("--", params.pattern, params.path ?? ".");

      const sandbox = await getSandbox();
      const { exitCode, stdout, stderr } = await sandbox.run(args, { cwd, signal });
      // ripgrep: 0 = matches, 1 = no matches, 2 = error
      if (exitCode === 1)
        return { content: [{ type: "text", text: "No matches found" }], details: {} };
      if (exitCode !== 0) throw new Error(stderr.toString().trim() || `rg exited with ${exitCode}`);

      const lines = stdout.toString().split("\n").filter(Boolean);
      const limited = lines.slice(0, limit);
      const truncation = truncateHead(limited.join("\n"));
      let text = truncation.content;
      if (lines.length > limit) text += `\n\n[${limit} matches limit reached]`;
      if (truncation.truncated) text += "\n\n[Output truncated]";
      return { content: [{ type: "text", text }], details: {} };
    },
  };
}

export function createSandboxTools(cwd: string, getSandbox: SandboxProvider): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [
    createBashTool(cwd, {
      operations: bashOperations(getSandbox),
      exposeSessionEnvironment: false,
    }),
    createReadTool(cwd, { operations: readOperations(getSandbox) }),
    createWriteTool(cwd, { operations: writeOperations(getSandbox) }),
    createEditTool(cwd, { operations: editOperations(getSandbox) }),
    createLsTool(cwd, { operations: lsOperations(getSandbox) }),
    createFindTool(cwd, { operations: findOperations(getSandbox) }),
    createSandboxGrepTool(cwd, getSandbox),
  ];
  // The model often batches e.g. `write` + `bash` in one turn; they share one filesystem,
  // so sandbox tools must run in order (a sequential tool serializes its whole batch).
  return tools.map((tool) => ({ ...tool, executionMode: "sequential" }));
}

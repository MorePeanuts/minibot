import { randomUUID } from "node:crypto";
import path from "node:path";
import { PassThrough, type Writable } from "node:stream";
import type Docker from "dockerode";
import { pack } from "tar-stream";

export interface ExecOptions {
  /** Working directory inside the container. Defaults to the sandbox workdir. */
  cwd?: string;
  /** Receives interleaved stdout/stderr chunks as they arrive. */
  onData?: (chunk: Buffer) => void;
  signal?: AbortSignal;
  /** Hard timeout in seconds; the whole process group is killed when exceeded. */
  timeoutSeconds?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number | null;
}

export interface RunResult {
  exitCode: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

export class SandboxTimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(`timeout:${seconds}`);
    this.name = "SandboxTimeoutError";
  }
}

export class SandboxAbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "SandboxAbortError";
  }
}

/** Directory (inside the container) where running command groups record their PGID. */
const PID_DIR = "/tmp/.minibot-pids";

/**
 * Starts the user command as the leader of a fresh session/process group and records
 * its PID, so it (and every child it spawns) can be killed on timeout or abort.
 * $1 = run id, $2 = command.
 */
const RUN_SCRIPT = `mkdir -p ${PID_DIR} && echo $$ > ${PID_DIR}/$1 && exec bash -lc "$2"`;

/**
 * A handle to one running sandbox container. All filesystem paths are container paths.
 */
export class Sandbox {
  constructor(
    private readonly docker: Docker,
    readonly container: Docker.Container,
    readonly workdir: string,
    private readonly touch: () => void,
  ) {}

  /** Run a shell command, streaming combined output through `onData`. */
  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const output = new PassThrough();
    if (options.onData) output.on("data", options.onData);
    return this.execRaw(
      ["setsid", "-w", "bash", "-c", RUN_SCRIPT, "minibot-run", randomUUID(), command],
      output,
      output,
      options,
    );
  }

  /** Run an argv command (no shell) and collect stdout / stderr separately. */
  async run(argv: string[], options: Omit<ExecOptions, "onData"> = {}): Promise<RunResult> {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const out = new PassThrough().on("data", (c: Buffer) => stdout.push(c));
    const err = new PassThrough().on("data", (c: Buffer) => stderr.push(c));
    const { exitCode } = await this.execRaw(argv, out, err, options);
    return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
  }

  async readFile(filePath: string): Promise<Buffer> {
    const { exitCode, stdout, stderr } = await this.run(["cat", "--", filePath]);
    if (exitCode !== 0) throw new Error(stderr.toString().trim() || `Cannot read ${filePath}`);
    return stdout;
  }

  /** Writes a file via the archive API, which handles binary data and large payloads safely. */
  async writeFile(filePath: string, content: string | Buffer): Promise<void> {
    const dir = path.posix.dirname(filePath);
    await this.mkdir(dir);
    const tar = pack();
    tar.entry({ name: path.posix.basename(filePath), mode: 0o644, uid: 1000, gid: 1000 }, content);
    tar.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of tar) chunks.push(chunk as Buffer);
    this.touch();
    await this.container.putArchive(Buffer.concat(chunks), { path: dir });
  }

  async mkdir(dir: string): Promise<void> {
    const { exitCode, stderr } = await this.run(["mkdir", "-p", "--", dir]);
    if (exitCode !== 0) throw new Error(stderr.toString().trim() || `Cannot create ${dir}`);
  }

  private async execRaw(
    argv: string[],
    stdout: Writable,
    stderr: Writable,
    options: ExecOptions,
  ): Promise<ExecResult> {
    const { signal, timeoutSeconds } = options;
    if (signal?.aborted) throw new SandboxAbortError();
    this.touch();

    const exec = await this.container.exec({
      Cmd: argv,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options.cwd ?? this.workdir,
      Env: options.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    this.docker.modem.demuxStream(stream, stdout, stderr);

    const runId = argv[0] === "setsid" ? argv[6] : undefined;
    let interrupted: Error | undefined;
    const interrupt = (error: Error) => {
      if (interrupted) return;
      interrupted = error;
      if (runId) void this.killGroup(runId);
      stream.destroy();
    };

    const timer = timeoutSeconds
      ? setTimeout(() => interrupt(new SandboxTimeoutError(timeoutSeconds)), timeoutSeconds * 1000)
      : undefined;
    const onAbort = () => interrupt(new SandboxAbortError());
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await new Promise<void>((resolve, reject) => {
        stream.on("end", resolve);
        stream.on("close", resolve);
        stream.on("error", (e) => (interrupted ? resolve() : reject(e)));
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    if (interrupted) throw interrupted;

    const info = await exec.inspect();
    return { exitCode: info.ExitCode ?? null };
  }

  private async killGroup(runId: string) {
    try {
      const exec = await this.container.exec({
        Cmd: ["sh", "-c", `kill -KILL -- -"$(cat ${PID_DIR}/${runId})" 2>/dev/null; true`],
      });
      await exec.start({ hijack: true, stdin: false });
    } catch {
      // best effort: the container may already be gone
    }
  }
}

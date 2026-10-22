import type Docker from "dockerode";
import { Sandbox } from "./sandbox";

export interface SandboxManagerConfig {
  /** Docker image providing bash, coreutils, ripgrep, fd, python ... (see docker/sandbox). */
  image: string;
  /** Docker network mode for sandboxes. "none" fully disables network access. */
  network: string;
  memoryMb: number;
  cpus: number;
  pidsLimit: number;
  /** Containers idle for longer than this are stopped (not removed). */
  idleTimeoutMinutes: number;
  workdir?: string;
}

const LABEL = "dev.minibot.sandbox";
const containerName = (sessionId: string) => `minibot-sbx-${sessionId}`;

function isNotFound(error: unknown) {
  return (error as { statusCode?: number } | null)?.statusCode === 404;
}

/**
 * Owns the lifecycle of per-session sandbox containers:
 * lazily created on first use, stopped when idle, removed with their session.
 */
export class SandboxManager {
  private readonly pending = new Map<string, Promise<Sandbox>>();
  private readonly lastUsed = new Map<string, number>();
  private reaper: NodeJS.Timeout | undefined;
  readonly workdir: string;

  constructor(
    private readonly docker: Docker,
    private readonly config: SandboxManagerConfig,
  ) {
    this.workdir = config.workdir ?? "/workspace";
  }

  /** Returns a running sandbox for the session, creating or starting it as needed. */
  acquire(sessionId: string): Promise<Sandbox> {
    // De-duplicate concurrent acquisitions for the same session.
    let promise = this.pending.get(sessionId);
    if (!promise) {
      promise = this.ensureRunning(sessionId).finally(() => this.pending.delete(sessionId));
      this.pending.set(sessionId, promise);
    }
    return promise;
  }

  async remove(sessionId: string): Promise<void> {
    this.lastUsed.delete(sessionId);
    try {
      await this.docker.getContainer(containerName(sessionId)).remove({ force: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Copies the workspace of one session into another (used when forking a conversation). */
  async copyWorkspace(fromSessionId: string, toSessionId: string): Promise<boolean> {
    const source = this.docker.getContainer(containerName(fromSessionId));
    let archive: NodeJS.ReadableStream;
    try {
      archive = await source.getArchive({ path: `${this.workdir}/.` });
    } catch (error) {
      if (isNotFound(error)) return false; // source never used its sandbox
      throw error;
    }
    const target = await this.acquire(toSessionId);
    await target.container.putArchive(archive, { path: this.workdir });
    return true;
  }

  /** Periodically stops idle containers to free host resources. */
  startReaper(intervalMs = 60_000) {
    if (this.reaper) return;
    this.reaper = setInterval(() => void this.stopIdle(), intervalMs);
    this.reaper.unref();
  }

  stopReaper() {
    clearInterval(this.reaper);
    this.reaper = undefined;
  }

  private async stopIdle() {
    const cutoff = Date.now() - this.config.idleTimeoutMinutes * 60_000;
    for (const [sessionId, at] of this.lastUsed) {
      if (at > cutoff) continue;
      this.lastUsed.delete(sessionId);
      await this.docker
        .getContainer(containerName(sessionId))
        .stop({ t: 2 })
        .catch(() => undefined);
    }
  }

  private async ensureRunning(sessionId: string): Promise<Sandbox> {
    const name = containerName(sessionId);
    let container = this.docker.getContainer(name);
    try {
      const info = await container.inspect();
      if (!info.State.Running) await container.start();
    } catch (error) {
      if (!isNotFound(error)) throw error;
      container = await this.create(sessionId);
      await container.start();
    }
    const touch = () => this.lastUsed.set(sessionId, Date.now());
    touch();
    return new Sandbox(this.docker, container, this.workdir, touch);
  }

  private async create(sessionId: string) {
    const { image, network, memoryMb, cpus, pidsLimit } = this.config;
    try {
      await this.docker.getImage(image).inspect();
    } catch (error) {
      if (isNotFound(error)) {
        throw new Error(
          `Sandbox image "${image}" not found. Build it with \`pnpm sandbox:build\` ` +
            "(or `docker compose build sandbox-image`).",
          { cause: error },
        );
      }
      throw error;
    }

    return this.docker.createContainer({
      name: containerName(sessionId),
      Image: image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: this.workdir,
      Labels: { [LABEL]: "true", [`${LABEL}.session`]: sessionId },
      HostConfig: {
        Init: true,
        NetworkMode: network,
        Memory: memoryMb * 1024 * 1024,
        NanoCpus: Math.round(cpus * 1e9),
        PidsLimit: pidsLimit,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
      },
    });
  }
}

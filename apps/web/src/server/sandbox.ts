import "server-only";
import { Docker, SandboxManager } from "@minibot/sandbox";
import { env } from "@/env";

const globalForSandbox = globalThis as unknown as { sandboxManager?: SandboxManager };

function createManager() {
  // dockerode honours DOCKER_HOST (e.g. tcp://docker-proxy:2375 in docker-compose).
  const manager = new SandboxManager(new Docker(), {
    image: env.SANDBOX_IMAGE,
    network: env.SANDBOX_NETWORK,
    memoryMb: env.SANDBOX_MEMORY_MB,
    cpus: env.SANDBOX_CPUS,
    pidsLimit: env.SANDBOX_PIDS_LIMIT,
    idleTimeoutMinutes: env.SANDBOX_IDLE_MINUTES,
  });
  manager.startReaper();
  return manager;
}

export const sandboxManager = globalForSandbox.sandboxManager ?? createManager();
globalForSandbox.sandboxManager = sandboxManager;

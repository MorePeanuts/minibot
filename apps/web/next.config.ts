import type { NextConfig } from "next";

// One .env at the monorepo root is shared by the web app, drizzle-kit and docker compose.
// (In Docker the variables come from the environment and the file does not exist.)
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // no .env file — rely on the real environment
}

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile).
  output: "standalone",
  // Monorepo root, so standalone tracing includes workspace packages.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  // Internal workspace packages ship TypeScript sources ("just-in-time" packages).
  transpilePackages: ["@minibot/db", "@minibot/agent", "@minibot/sandbox"],
  // Heavy Node-only dependencies are loaded at runtime instead of being bundled.
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "dockerode",
    "ssh2",
  ],
  typedRoutes: true,
  // Keep the dev badge away from the sidebar user menu.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;

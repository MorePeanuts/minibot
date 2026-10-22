import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Type-safe, validated environment. Importing `env` anywhere fails fast with a
 * readable error when configuration is missing or malformed.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "Use at least 32 random characters"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    /** Master secret used to derive the AES key that encrypts users' API keys at rest. */
    ENCRYPTION_KEY: z.string().min(32, "Use at least 32 random characters"),
    /** Optional server-wide fallback key, used when a user has not configured their own. */
    DEEPSEEK_API_KEY: z.string().optional(),
    SANDBOX_IMAGE: z.string().default("minibot-sandbox:latest"),
    SANDBOX_NETWORK: z.string().default("none"),
    SANDBOX_MEMORY_MB: z.coerce.number().int().positive().default(512),
    SANDBOX_CPUS: z.coerce.number().positive().default(1),
    SANDBOX_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
    SANDBOX_IDLE_MINUTES: z.coerce.number().int().positive().default(15),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
  // Docker image builds run `next build` without secrets.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

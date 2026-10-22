/** Loads the monorepo root .env (if present) for CLI tools such as drizzle-kit and migrate. */
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // no .env file — rely on the real environment
}

import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "@/env";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

// Derived lazily: modules are evaluated during `next build`, where secrets are absent.
let cachedKey: Buffer | undefined;
const key = () =>
  (cachedKey ??= Buffer.from(
    hkdfSync("sha256", env.ENCRYPTION_KEY, "minibot", "api-key-encryption", 32),
  ));

/** Encrypts a secret as `v1:<iv>:<tag>:<ciphertext>` (base64url parts). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Malformed secret");
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** "sk-abcd…wxyz" — safe to show in the UI. */
export function maskSecret(secret: string): string {
  return secret.length <= 10 ? "••••" : `${secret.slice(0, 5)}…${secret.slice(-4)}`;
}

/**
 * AI API Key Encryption — AES-256-GCM
 *
 * Encrypts user-provided Anthropic API keys before storage in Convex.
 * Decrypts only inside "use node" actions at call time.
 *
 * The encryption key (AI_ENCRYPTION_KEY) is a Convex environment variable.
 * Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from "node:crypto";
import type { EncryptedValue } from "./types";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard (96 bits)

/**
 * Get the encryption key from environment.
 * Must be 32 bytes (64 hex characters).
 */
function getEncryptionKey(): Buffer {
  const key = process.env.AI_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "AI_ENCRYPTION_KEY must be a 64-character hex string. " +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a plaintext API key.
 * Returns a versioned encrypted value object.
 */
export function encryptApiKey(plaintext: string): EncryptedValue {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ct = cipher.update(plaintext, "utf8", "hex");
  ct += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return {
    v: 1,
    ct,
    iv: iv.toString("hex"),
    tag,
  };
}

/**
 * Decrypt an encrypted API key.
 * Validates version and auth tag.
 */
export function decryptApiKey(encrypted: EncryptedValue): string {
  if (encrypted.v !== 1) {
    throw new Error(`Unsupported encryption version: ${encrypted.v}`);
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encrypted.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));

  let plaintext = decipher.update(encrypted.ct, "hex", "utf8");
  plaintext += decipher.final("utf8");
  return plaintext;
}

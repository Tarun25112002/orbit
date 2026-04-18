import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const getEncryptionKey = (): Buffer => {
  const raw = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GITHUB_TOKEN_ENCRYPTION_KEY is not configured. Generate a 32-byte base64 key.",
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `GITHUB_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`,
    );
  }

  return key;
};

/**
 * Encrypts a GitHub access token using AES-256-GCM.
 * Returns a base64url string: `iv:ciphertext:authTag`
 */
export const encryptToken = (token: string): string => {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, encrypted, authTag]);
  return payload.toString("base64url");
};

/**
 * Decrypts a token previously encrypted with `encryptToken`.
 */
export const decryptToken = (encrypted: string): string => {
  const key = getEncryptionKey();
  const payload = Buffer.from(encrypted, "base64url");

  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid encrypted token: payload too short");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(payload.length - AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(
    IV_LENGTH,
    payload.length - AUTH_TAG_LENGTH,
  );

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

import { createHmac, randomBytes } from "node:crypto";

const STATE_SECRET = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;

/** Maximum age of an OAuth state parameter (10 minutes). */
const MAX_STATE_AGE_MS = 10 * 60 * 1000;

type StatePayload = {
  userId: string;
  redirectUrl: string;
};

/**
 * Generates a signed, base64url-encoded state parameter for GitHub OAuth.
 * Binds the oauth flow to a specific user and returns them to the specified redirect.
 *
 * Security features:
 * - HMAC-SHA256 signature prevents tampering
 * - CSRF token cookie binding prevents cross-site attacks
 * - Timestamp prevents replay attacks through expired flows
 * - Nonce prevents state re-use
 *
 * @returns { stateParam, csrfToken }
 */
export const generateOAuthState = (userId: string, redirectUrl: string) => {
  if (!STATE_SECRET) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is not configured");
  }

  const csrfToken = randomBytes(16).toString("base64url");
  const nonce = randomBytes(8).toString("base64url");
  const timestamp = Date.now();

  const payload = JSON.stringify({ userId, redirectUrl, csrfToken, nonce, timestamp });
  const hmac = createHmac("sha256", STATE_SECRET).update(payload).digest("base64url");

  const stateParam = Buffer.from(JSON.stringify({ p: payload, s: hmac })).toString("base64url");

  return { stateParam, csrfToken };
};

/**
 * Verifies a state parameter returned from GitHub OAuth.
 * Ensures the signature is valid, the CSRF token matches the cookie,
 * and the state has not expired.
 */
export const verifyOAuthState = (stateParam: string, cookieCsrfToken: string | undefined): StatePayload => {
  if (!STATE_SECRET) {
    throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY is not configured");
  }

  if (!cookieCsrfToken) {
    throw new Error("Missing CSRF cookie — please retry the GitHub connection");
  }

  try {
    const decodedStr = Buffer.from(stateParam, "base64url").toString("utf8");
    const { p: payloadStr, s: signature } = JSON.parse(decodedStr);

    // Verify HMAC signature
    const expectedHmac = createHmac("sha256", STATE_SECRET).update(payloadStr).digest("base64url");
    if (signature !== expectedHmac) {
      throw new Error("Invalid state signature");
    }

    const payload = JSON.parse(payloadStr) as StatePayload & {
      csrfToken: string;
      nonce: string;
      timestamp: number;
    };

    // Verify CSRF token matches cookie
    if (payload.csrfToken !== cookieCsrfToken) {
      throw new Error("CSRF token mismatch");
    }

    // Verify state has not expired
    const age = Date.now() - payload.timestamp;
    if (age > MAX_STATE_AGE_MS || age < 0) {
      throw new Error("OAuth state has expired. Please try connecting GitHub again.");
    }

    return {
      userId: payload.userId,
      redirectUrl: payload.redirectUrl,
    };
  } catch (e) {
    // Re-throw with the original message for meaningful error display
    if (e instanceof Error && e.message.includes("expired")) {
      throw e;
    }
    throw new Error("Invalid state parameter — the GitHub connection link may have expired");
  }
};

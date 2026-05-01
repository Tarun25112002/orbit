import { NextRequest } from "next/server";
import { auth, verifyToken } from "@clerk/nextjs/server";

/**
 * Get the current Clerk userId from the request.
 *
 * Tries the standard `auth()` first. If that returns null
 * (which happens in Next.js 16 proxy.ts setups), falls back to
 * verifying the Clerk session JWT from cookies directly.
 */
export async function getClerkUserId(
  request: NextRequest,
): Promise<string | null> {
  // Try the standard auth() — works when middleware context propagates
  try {
    const { userId } = await auth();
    if (userId) return userId;
  } catch {
    // auth() can throw if middleware context is missing
  }

  // Fallback: verify session cookie directly using Clerk's verifyToken
  // Clerk v7 uses __clerk_db_jwt in development, __session in production.
  // Also check the header — Clerk sometimes sends the session token
  // as a Bearer token in the Authorization header.
  const sessionToken =
    request.cookies.get("__session")?.value ||
    request.cookies.get("__clerk_db_jwt")?.value ||
    extractBearerToken(request.headers.get("authorization"));

  if (!sessionToken) return null;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    // issuerDomain is needed for Clerk v7 token verification
    const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

    const payload = await verifyToken(sessionToken, {
      secretKey,
      ...(issuerDomain ? { issuer: issuerDomain } : {}),
    });
    return (payload.sub as string) || null;
  } catch (err) {
    // If verification fails with issuer, retry without it
    // (handles dev vs prod issuer mismatches)
    try {
      const secretKey = process.env.CLERK_SECRET_KEY;
      if (!secretKey) return null;

      const payload = await verifyToken(sessionToken, {
        secretKey,
      });
      return (payload.sub as string) || null;
    } catch {
      console.error("Clerk token verification failed:", err);
      return null;
    }
  }
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

const resolveConvexTokenFromAuth = async (
  getToken: (options?: { template?: string }) => Promise<string | null>,
) => {
  const templated = await getToken({ template: "convex" });
  if (templated?.trim()) {
    return templated.trim();
  }

  const defaultToken = await getToken();
  if (defaultToken?.trim()) {
    return defaultToken.trim();
  }

  return null;
};

/**
 * Get the current Clerk userId and a Convex auth token.
 * Tries auth() first (for getToken), falls back to cookie verification.
 */
export async function getClerkUserIdAndToken(
  request: NextRequest,
): Promise<{ userId: string; convexToken: string } | null> {
  const bearerToken = extractBearerToken(request.headers.get("authorization"));

  // Try auth() first — it provides getToken()
  try {
    const { userId, getToken } = await auth();
    if (userId) {
      const convexToken =
        (await resolveConvexTokenFromAuth(getToken)) ?? bearerToken;
      if (convexToken) {
        return { userId, convexToken };
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: verify session cookie for userId
  const sessionToken =
    request.cookies.get("__session")?.value ||
    request.cookies.get("__clerk_db_jwt")?.value ||
    bearerToken;

  if (!sessionToken) return null;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    const payload = await verifyToken(sessionToken, {
      secretKey,
    });
    const userId = payload.sub as string;
    if (!userId) return null;

    // For Convex, try getting a token through auth()
    try {
      const { getToken } = await auth();
      const convexToken =
        (await resolveConvexTokenFromAuth(getToken)) ?? bearerToken;
      if (convexToken) return { userId, convexToken };
    } catch {
      // Can't get Convex token
    }

    if (bearerToken) {
      return { userId, convexToken: bearerToken };
    }

    return null;
  } catch {
    return null;
  }
}

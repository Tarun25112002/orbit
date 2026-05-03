import { NextRequest } from "next/server";
import { auth, verifyToken } from "@clerk/nextjs/server";

export async function getClerkUserId(
  request: NextRequest,
): Promise<string | null> {

  try {
    const { userId } = await auth();
    if (userId) return userId;
  } catch {

  }

  const sessionToken =
    request.cookies.get("__session")?.value ||
    request.cookies.get("__clerk_db_jwt")?.value ||
    extractBearerToken(request.headers.get("authorization"));

  if (!sessionToken) return null;

  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

    const payload = await verifyToken(sessionToken, {
      secretKey,
      ...(issuerDomain ? { issuer: issuerDomain } : {}),
    });
    return (payload.sub as string) || null;
  } catch (err) {

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

export async function getClerkUserIdAndToken(
  request: NextRequest,
): Promise<{ userId: string; convexToken: string } | null> {
  const bearerToken = extractBearerToken(request.headers.get("authorization"));

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

  }

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

    try {
      const { getToken } = await auth();
      const convexToken =
        (await resolveConvexTokenFromAuth(getToken)) ?? bearerToken;
      if (convexToken) return { userId, convexToken };
    } catch {

    }

    if (bearerToken) {
      return { userId, convexToken: bearerToken };
    }

    return null;
  } catch {
    return null;
  }
}

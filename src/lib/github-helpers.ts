import { NextRequest, NextResponse } from "next/server";
import { getClerkUserId, getClerkUserIdAndToken } from "@/lib/clerk-auth";
import { decryptToken } from "@/lib/github-crypto";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export const clearGitHubCookies = (response: NextResponse) => {
  response.cookies.set("github_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set("github_token_owner", "", { ...COOKIE_OPTIONS, maxAge: 0 });
  response.cookies.set("github_oauth_state", "", { ...COOKIE_OPTIONS, maxAge: 0 });
};

type AuthSuccess = {
  ok: true;
  token: string;
  userId: string;
};

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

export type GitHubAuthResult = AuthSuccess | AuthFailure;

export async function getAuthenticatedGitHubToken(
  request: NextRequest,
): Promise<GitHubAuthResult> {
  const userId = await getClerkUserId(request);

  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const encryptedToken = request.cookies.get("github_token")?.value;
  const tokenOwnerUserId = request.cookies.get("github_token_owner")?.value;

  if (!encryptedToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "GitHub not connected. Please connect your GitHub account." },
        { status: 401 },
      ),
    };
  }

  if (!tokenOwnerUserId || tokenOwnerUserId !== userId) {
    const response = NextResponse.json(
      { error: "GitHub session expired. Please reconnect your GitHub account." },
      { status: 401 },
    );
    clearGitHubCookies(response);
    return { ok: false, response };
  }

  try {
    const token = decryptToken(encryptedToken);
    return { ok: true, token, userId };
  } catch {
    const response = NextResponse.json(
      { error: "GitHub token is invalid. Please reconnect your GitHub account." },
      { status: 401 },
    );
    clearGitHubCookies(response);
    return { ok: false, response };
  }
}

export async function getAuthenticatedGitHubTokenWithConvex(
  request: NextRequest,
): Promise<
  | { ok: true; token: string; userId: string; convexToken: string }
  | { ok: false; response: NextResponse }
> {
  const result = await getClerkUserIdAndToken(request);

  if (!result) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { userId, convexToken } = result;

  const encryptedToken = request.cookies.get("github_token")?.value;
  const tokenOwnerUserId = request.cookies.get("github_token_owner")?.value;

  if (!encryptedToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "GitHub not connected. Please connect your GitHub account." },
        { status: 401 },
      ),
    };
  }

  if (!tokenOwnerUserId || tokenOwnerUserId !== userId) {
    const response = NextResponse.json(
      { error: "GitHub session expired. Please reconnect your GitHub account." },
      { status: 401 },
    );
    clearGitHubCookies(response);
    return { ok: false, response };
  }

  let token: string;
  try {
    token = decryptToken(encryptedToken);
  } catch {
    const response = NextResponse.json(
      { error: "GitHub token is invalid. Please reconnect your GitHub account." },
      { status: 401 },
    );
    clearGitHubCookies(response);
    return { ok: false, response };
  }

  return { ok: true, token, userId, convexToken };
}

import { NextRequest, NextResponse } from "next/server";
import { getClerkUserId } from "@/lib/clerk-auth";
import { generateOAuthState } from "@/lib/github-oauth-state";

export async function GET(request: NextRequest) {
  const userId = await getClerkUserId(request);

  const { searchParams } = request.nextUrl;
  const requestedRedirect = searchParams.get("redirect") || "/dashboard";

  if (!userId) {

    const origin = new URL(request.url).origin;
    const signInUrl = new URL("/sign-in", origin);

    signInUrl.searchParams.set(
      "redirect_url",
      `/api/auth/github/connect?redirect=${encodeURIComponent(requestedRedirect)}`
    );
    return NextResponse.redirect(signInUrl.toString());
  }

  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured on the server" },
      { status: 500 },
    );
  }

  const origin = request.nextUrl.origin;
  const redirectUri =
    process.env.GITHUB_OAUTH_REDIRECT_URI ||
    `${origin}/api/auth/github/callback`;

  const { stateParam, csrfToken } = generateOAuthState(userId, requestedRedirect);

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", clientId);
  githubUrl.searchParams.set("scope", "repo");
  githubUrl.searchParams.set("redirect_uri", redirectUri);
  githubUrl.searchParams.set("state", stateParam);
  githubUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(githubUrl.toString());

  response.cookies.set("github_oauth_state", csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { getClerkUserId } from "@/lib/clerk-auth";
import { encryptToken } from "@/lib/github-crypto";
import { verifyOAuthState } from "@/lib/github-oauth-state";
import { clearGitHubCookies } from "@/lib/github-helpers";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !stateParam) {
    const errorType = error || "missing_params";

    let redirectTo = "/dashboard";
    if (stateParam) {
      try {

        const outer = JSON.parse(
          Buffer.from(stateParam, "base64url").toString("utf8"),
        );
        const payload = JSON.parse(outer.p);
        if (payload.redirectUrl) redirectTo = payload.redirectUrl;
      } catch {

      }
    }
    const redirectUrl = new URL(redirectTo, request.url);
    redirectUrl.searchParams.set("github_error", errorType);
    return NextResponse.redirect(redirectUrl);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri =
    process.env.GITHUB_OAUTH_REDIRECT_URI ||
    `${request.nextUrl.origin}/api/auth/github/callback`;

  const userId = await getClerkUserId(request);

  if (!userId) {
    return NextResponse.redirect(
      new URL("/sign-in?github_error=not_authenticated", request.url),
    );
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured" },
      { status: 500 },
    );
  }

  const cookieCsrfToken = request.cookies.get("github_oauth_state")?.value;

  try {

    const { userId: stateUserId, redirectUrl } = verifyOAuthState(
      stateParam,
      cookieCsrfToken,
    );

    if (stateUserId !== userId) {
      console.error(
        "GitHub OAuth error: User mismatch — flow started by",
        stateUserId,
        "but completed by",
        userId,
      );
      const errorUrl = new URL(redirectUrl || "/dashboard", request.url);
      errorUrl.searchParams.set("github_error", "user_mismatch");
      return NextResponse.redirect(errorUrl);
    }

    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      console.error("GitHub OAuth error:", tokenData.error_description);
      const tokenErrorUrl = new URL(redirectUrl || "/dashboard", request.url);
      tokenErrorUrl.searchParams.set("github_error", "token_exchange_failed");
      return NextResponse.redirect(tokenErrorUrl);
    }

    const encrypted = encryptToken(tokenData.access_token);

    const redirectTarget = new URL(redirectUrl, request.url);
    redirectTarget.searchParams.set("github_connected", "1");
    const response = NextResponse.redirect(redirectTarget);

    response.cookies.set("github_token", encrypted, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.set("github_token_owner", userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.set("github_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);

    let fallbackRedirect = "/dashboard";
    if (stateParam) {
      try {
        const outer = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
        const payload = JSON.parse(outer.p);
        if (payload.redirectUrl) fallbackRedirect = payload.redirectUrl;
      } catch {  }
    }
    const serverErrorUrl = new URL(fallbackRedirect, request.url);
    serverErrorUrl.searchParams.set("github_error", "server_error");
    const errorResponse = NextResponse.redirect(serverErrorUrl);
    clearGitHubCookies(errorResponse);
    return errorResponse;
  }
}

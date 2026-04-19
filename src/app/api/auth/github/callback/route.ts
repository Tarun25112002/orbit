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

  // User cancelled or GitHub denied access — redirect back gracefully
  if (error || !code || !stateParam) {
    const errorType = error || "missing_params";
    // Try to extract redirect from the state, fallback to dashboard
    let redirectTo = "/dashboard";
    if (stateParam) {
      try {
        // State format: base64url(JSON{ p: payloadStr, s: hmac })
        const outer = JSON.parse(
          Buffer.from(stateParam, "base64url").toString("utf8"),
        );
        const payload = JSON.parse(outer.p);
        if (payload.redirectUrl) redirectTo = payload.redirectUrl;
      } catch {
        // ignore parse errors — use default redirect
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
    // Verify the state parameter: HMAC signature, CSRF cookie match, timestamp expiry
    const { userId: stateUserId, redirectUrl } = verifyOAuthState(
      stateParam,
      cookieCsrfToken,
    );

    // Ensure the user completing the flow is the one who started it
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

    // Exchange authorization code for access token
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

    // Encrypt the token before storing
    const encrypted = encryptToken(tokenData.access_token);

    // Redirect back to the app with the token in a secure cookie
    const redirectTarget = new URL(redirectUrl, request.url);
    redirectTarget.searchParams.set("github_connected", "1");
    const response = NextResponse.redirect(redirectTarget);

    // Store encrypted token — bound to this user via github_token_owner
    response.cookies.set("github_token", encrypted, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // User binding — every API route checks this against the current Clerk userId
    response.cookies.set("github_token_owner", userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    // Clear the short-lived CSRF state cookie
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

    // Clear any partial state
    // Try to extract redirect from the state so user stays on their project page
    let fallbackRedirect = "/dashboard";
    if (stateParam) {
      try {
        const outer = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8"));
        const payload = JSON.parse(outer.p);
        if (payload.redirectUrl) fallbackRedirect = payload.redirectUrl;
      } catch { /* ignore parse errors */ }
    }
    const serverErrorUrl = new URL(fallbackRedirect, request.url);
    serverErrorUrl.searchParams.set("github_error", "server_error");
    const errorResponse = NextResponse.redirect(serverErrorUrl);
    clearGitHubCookies(errorResponse);
    return errorResponse;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { encryptToken } from "@/lib/github-crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json(
      { error: "Missing authorization code" },
      { status: 400 },
    );
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured" },
      { status: 500 },
    );
  }

  try {
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
      return NextResponse.redirect(
        new URL("/?github_error=auth_failed", request.url),
      );
    }

    // Encrypt the token
    const encrypted = encryptToken(tokenData.access_token);

    // Redirect back to the app with the token in a secure cookie
    const returnUrl = searchParams.get("state") || "/dashboard";
    const response = NextResponse.redirect(new URL(returnUrl, request.url));

    response.cookies.set("github_token", encrypted, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error) {
    console.error("GitHub OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/?github_error=server_error", request.url),
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getClerkUserId } from "@/lib/clerk-auth";
import { decryptToken } from "@/lib/github-crypto";
import { GitHubClient } from "@/lib/github-client";
import { clearGitHubCookies } from "@/lib/github-helpers";

export async function GET(request: NextRequest) {
  const encryptedToken = request.cookies.get("github_token")?.value;
  const tokenOwnerUserId = request.cookies.get("github_token_owner")?.value;
  const userId = await getClerkUserId(request);

  if (!encryptedToken || !userId) {
    return NextResponse.json({ connected: false });
  }

  if (!tokenOwnerUserId || tokenOwnerUserId !== userId) {
    const response = NextResponse.json({
      connected: false,
      reason: "session_mismatch",
    });
    clearGitHubCookies(response);
    return response;
  }

  try {
    const token = decryptToken(encryptedToken);
    const client = new GitHubClient(token);
    const user = await client.getUser();

    return NextResponse.json({
      connected: true,
      user: {
        login: user.login,
        avatar_url: user.avatar_url,
        name: user.name,
        html_url: user.html_url,
      },
    });
  } catch (error) {
    console.error("GitHub Connection Error:", error);

    const response = NextResponse.json({
      connected: false,
      reason: "token_invalid",
    });
    clearGitHubCookies(response);
    return response;
  }
}

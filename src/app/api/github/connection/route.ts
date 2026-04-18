import { NextRequest, NextResponse } from "next/server";
import { decryptToken } from "@/lib/github-crypto";
import { GitHubClient } from "@/lib/github-client";

export async function GET(request: NextRequest) {
  const encryptedToken = request.cookies.get("github_token")?.value;

  if (!encryptedToken) {
    return NextResponse.json({ connected: false });
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
  } catch {
    // Token invalid or expired — clear cookie
    const response = NextResponse.json({ connected: false });
    response.cookies.set("github_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }
}

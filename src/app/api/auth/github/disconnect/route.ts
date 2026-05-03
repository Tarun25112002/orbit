import { NextRequest, NextResponse } from "next/server";
import { getClerkUserId } from "@/lib/clerk-auth";
import { clearGitHubCookies } from "@/lib/github-helpers";

export async function POST(request: NextRequest) {
  const userId = await getClerkUserId(request);

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokenOwnerUserId = request.cookies.get("github_token_owner")?.value;
  if (tokenOwnerUserId && tokenOwnerUserId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ disconnected: true });
  clearGitHubCookies(response);
  return response;
}

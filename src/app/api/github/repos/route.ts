import { NextRequest, NextResponse } from "next/server";
import { decryptToken } from "@/lib/github-crypto";
import { GitHubClient } from "@/lib/github-client";

export async function GET(request: NextRequest) {
  const encryptedToken = request.cookies.get("github_token")?.value;

  if (!encryptedToken) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  try {
    const token = decryptToken(encryptedToken);
    const client = new GitHubClient(token);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const perPage = parseInt(searchParams.get("per_page") || "30", 10);

    const repos = await client.listRepos(page, Math.min(perPage, 100));

    return NextResponse.json({
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        html_url: r.html_url,
        description: r.description,
        default_branch: r.default_branch,
        updated_at: r.updated_at,
      })),
    });
  } catch (error) {
    console.error("GitHub repos error:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}

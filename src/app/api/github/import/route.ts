import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { decryptToken } from "@/lib/github-crypto";
import { GitHubClient } from "@/lib/github-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(request: NextRequest) {
  const encryptedToken = request.cookies.get("github_token")?.value;

  if (!encryptedToken) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  const { getToken } = await auth();
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  convex.setAuth(convexToken);

  try {
    const body = (await request.json()) as {
      projectId: string;
      owner: string;
      repo: string;
      branch?: string;
    };

    const { projectId, owner, repo, branch } = body;

    if (!projectId || !owner || !repo) {
      return NextResponse.json(
        { error: "Missing projectId, owner, or repo" },
        { status: 400 },
      );
    }

    // Mark import as started
    await convex.mutation(api.projects.startGithubImport, {
      projectId: projectId as Id<"projects">,
      githubUrl: `https://github.com/${owner}/${repo}`,
    });

    const token = decryptToken(encryptedToken);
    const client = new GitHubClient(token);

    // Fetch all files from GitHub
    const files = await client.fetchRepoFiles(owner, repo, branch);

    // Write files to Convex
    for (const file of files) {
      try {
        await convex.mutation(api.files.createFile, {
          projectId: projectId as Id<"projects">,
          name: file.path,
          content: file.content,
        });
      } catch (error) {
        // Skip duplicate files (e.g. if import is re-run)
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("already exists")) continue;
        console.warn(`Skipped file ${file.path}:`, msg);
      }
    }

    // Mark import as completed
    await convex.mutation(api.projects.completeGithubImport, {
      projectId: projectId as Id<"projects">,
      importRepoUrl: `https://github.com/${owner}/${repo}`,
    });

    return NextResponse.json({
      success: true,
      filesImported: files.length,
      repoUrl: `https://github.com/${owner}/${repo}`,
    });
  } catch (error) {
    console.error("GitHub import error:", error);

    // Try to mark import as failed
    try {
      const body = (await request.clone().json()) as { projectId?: string };
      if (body.projectId) {
        await convex.mutation(api.projects.failGithubImport, {
          projectId: body.projectId as Id<"projects">,
        });
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Import failed",
      },
      { status: 500 },
    );
  }
}

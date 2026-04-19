import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { getAuthenticatedGitHubTokenWithConvex } from "@/lib/github-helpers";
import { GitHubClient } from "@/lib/github-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

type FileDoc = {
  _id: Id<"files">;
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  name: string;
  type: "file" | "folder";
  content?: string;
  updatedAt: number;
};

/** Recursively build flat file paths from the Convex file tree */
const buildFilePaths = (
  files: FileDoc[],
  parentId: Id<"files"> | undefined,
  prefix: string,
): { path: string; content: string }[] => {
  const result: { path: string; content: string }[] = [];
  const children = files.filter((f) => f.parentId === parentId);

  for (const child of children) {
    const fullPath = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.type === "file" && child.content !== undefined) {
      result.push({ path: fullPath, content: child.content });
    } else if (child.type === "folder") {
      result.push(...buildFilePaths(files, child._id, fullPath));
    }
  }

  return result;
};

export async function POST(request: NextRequest) {
  const authResult = await getAuthenticatedGitHubTokenWithConvex(request);
  if (!authResult.ok) return authResult.response;

  convex.setAuth(authResult.convexToken);

  try {
    const body = (await request.json()) as {
      projectId: string;
      repoName: string;
      description?: string;
      isPrivate?: boolean;
    };

    const { projectId, repoName, description, isPrivate } = body;

    if (!projectId || !repoName) {
      return NextResponse.json(
        { error: "Missing projectId or repoName" },
        { status: 400 },
      );
    }

    // Mark export as started (Convex verifies project ownership)
    await convex.mutation(api.projects.startGithubExport, {
      projectId: projectId as Id<"projects">,
    });

    const client = new GitHubClient(authResult.token);
    const user = await client.getUser();

    // Create the GitHub repository under the authenticated user's account
    const repo = await client.createRepo({
      name: repoName,
      description: description || "Exported from Orbit",
      isPrivate: isPrivate ?? false,
    });

    // Wait briefly for GitHub to initialize the repo
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get all project files from Convex (verifies ownership)
    const allFiles = (await convex.query(api.files.getFiles, {
      projectId: projectId as Id<"projects">,
    })) as FileDoc[];

    const filesToCommit = buildFilePaths(allFiles, undefined, "");

    if (filesToCommit.length > 0) {
      // Commit all files to the user's new repo
      await client.commitFiles({
        owner: user.login,
        repo: repo.name,
        files: filesToCommit,
        message: "Export from Orbit",
      });
    }

    // Mark export as completed
    await convex.mutation(api.projects.completeGithubExport, {
      projectId: projectId as Id<"projects">,
      exportRepoUrl: repo.html_url,
    });

    return NextResponse.json({
      success: true,
      repoUrl: repo.html_url,
      filesExported: filesToCommit.length,
    });
  } catch (error) {
    console.error("GitHub export error:", error);

    // Try to mark export as failed
    try {
      const body = (await request.clone().json()) as { projectId?: string };
      if (body.projectId) {
        await convex.mutation(api.projects.failGithubExport, {
          projectId: body.projectId as Id<"projects">,
        });
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    );
  }
}

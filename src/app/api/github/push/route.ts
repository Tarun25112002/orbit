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
    const body = (await request.json()) as { projectId: string };
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const project = await convex.query(api.projects.getById, {
      id: projectId as Id<"projects">,
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const repoUrl = project.exportRepoUrl || project.importRepoUrl;
    if (!repoUrl) {
      return NextResponse.json(
        { error: "No linked GitHub repository. Export first." },
        { status: 400 },
      );
    }

    const urlParts = new URL(repoUrl).pathname.split("/").filter(Boolean);
    const owner = urlParts[0];
    const repo = urlParts[1];

    if (!owner || !repo) {
      return NextResponse.json(
        { error: "Invalid linked repo URL" },
        { status: 400 },
      );
    }

    const client = new GitHubClient(authResult.token);

    try {
      await client.getRepo(owner, repo);
    } catch {
      return NextResponse.json(
        { error: "You don't have access to the linked repository. The repo may belong to a different GitHub account." },
        { status: 403 },
      );
    }

    const allFiles = (await convex.query(api.files.getFiles, {
      projectId: projectId as Id<"projects">,
    })) as FileDoc[];

    const filesToCommit = buildFilePaths(allFiles, undefined, "");

    if (filesToCommit.length === 0) {
      return NextResponse.json({ error: "No files to push" }, { status: 400 });
    }

    const result = await client.commitFiles({
      owner,
      repo,
      files: filesToCommit,
      message: `Orbit sync: ${new Date().toISOString()}`,
    });

    return NextResponse.json({
      success: true,
      commitSha: result.commitSha,
      repoUrl: result.repoUrl,
      filesPushed: filesToCommit.length,
    });
  } catch (error) {
    console.error("GitHub push error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Push failed" },
      { status: 500 },
    );
  }
}

const GITHUB_API = "https://api.github.com";

type GitHubUser = {
  login: string;
  avatar_url: string;
  name: string | null;
  html_url: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  updated_at: string;
};

type GitHubBranch = {
  name: string;
  commit: { sha: string };
};

type GitHubTreeItem = {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

type GitHubTreeResponse = {
  sha: string;
  tree: GitHubTreeItem[];
  truncated: boolean;
};

type GitHubBlobResponse = {
  content: string;
  encoding: "base64" | "utf-8";
  size: number;
};

type GitHubCreateRepoResponse = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
};

type GitHubRefResponse = {
  ref: string;
  object: { sha: string; type: string };
};

type GitHubCommitResponse = {
  sha: string;
  tree: { sha: string };
};

type GitHubCreateTreeResponse = {
  sha: string;
};

export type { GitHubUser, GitHubRepo, GitHubBranch, GitHubTreeItem };

const MAX_FILE_SIZE = 1_000_000; // 1MB — GitHub REST API limit for content

class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export class GitHubClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Orbit-App",
        ...(options.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GitHubApiError(
        `GitHub API ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }

    return response.json() as Promise<T>;
  }

  // ─── User ──────────────────────────────────────────────────────────

  async getUser(): Promise<GitHubUser> {
    return this.request<GitHubUser>("/user");
  }

  // ─── Repos ─────────────────────────────────────────────────────────

  async listRepos(
    page = 1,
    perPage = 30,
  ): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(
      `/user/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=all`,
    );
  }

  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${owner}/${repo}`);
  }

  // ─── Branches ──────────────────────────────────────────────────────

  async listBranches(
    owner: string,
    repo: string,
  ): Promise<GitHubBranch[]> {
    return this.request<GitHubBranch[]>(
      `/repos/${owner}/${repo}/branches?per_page=100`,
    );
  }

  // ─── Tree (Import) ────────────────────────────────────────────────

  async getTree(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<GitHubTreeResponse> {
    return this.request<GitHubTreeResponse>(
      `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    );
  }

  async getBlob(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<GitHubBlobResponse> {
    return this.request<GitHubBlobResponse>(
      `/repos/${owner}/${repo}/git/blobs/${sha}`,
    );
  }

  /**
   * Fetches all files from a repo tree.
   * Skips files > 1MB and binary files.
   */
  async fetchRepoFiles(
    owner: string,
    repo: string,
    branch?: string,
  ): Promise<{ path: string; content: string }[]> {
    const repoInfo = await this.getRepo(owner, repo);
    const branchName = branch || repoInfo.default_branch;

    const branches = await this.listBranches(owner, repo);
    const branchRef = branches.find((b) => b.name === branchName);
    if (!branchRef) {
      throw new GitHubApiError(`Branch "${branchName}" not found`, 404);
    }

    const tree = await this.getTree(owner, repo, branchRef.commit.sha);
    const files: { path: string; content: string }[] = [];

    const blobs = tree.tree.filter(
      (item) =>
        item.type === "blob" &&
        (item.size === undefined || item.size <= MAX_FILE_SIZE),
    );

    // Fetch blobs in parallel with concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < blobs.length; i += CONCURRENCY) {
      const batch = blobs.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (blob) => {
          try {
            const blobData = await this.getBlob(owner, repo, blob.sha);
            if (blobData.encoding === "base64") {
              const decoded = Buffer.from(blobData.content, "base64").toString(
                "utf8",
              );
              // Skip binary files (files with null bytes)
              if (decoded.includes("\0")) return null;
              return { path: blob.path!, content: decoded };
            }
            return { path: blob.path!, content: blobData.content };
          } catch {
            return null;
          }
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          files.push(result.value);
        }
      }
    }

    return files;
  }

  // ─── Create Repo (Export) ─────────────────────────────────────────

  async createRepo(args: {
    name: string;
    description?: string;
    isPrivate?: boolean;
  }): Promise<GitHubCreateRepoResponse> {
    return this.request<GitHubCreateRepoResponse>("/user/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: args.name,
        description: args.description ?? "",
        private: args.isPrivate ?? false,
        auto_init: true,
      }),
    });
  }

  // ─── Commit files (Export/Push) ───────────────────────────────────

  async commitFiles(args: {
    owner: string;
    repo: string;
    files: { path: string; content: string }[];
    message: string;
    branch?: string;
  }): Promise<{ commitSha: string; repoUrl: string }> {
    const { owner, repo, files, message } = args;
    const repoInfo = await this.getRepo(owner, repo);
    const branch = args.branch || repoInfo.default_branch;

    // 1. Get the latest commit on the branch
    const ref = await this.request<GitHubRefResponse>(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    );
    const latestCommitSha = ref.object.sha;

    // 2. Get the tree of the latest commit
    const latestCommit = await this.request<GitHubCommitResponse>(
      `/repos/${owner}/${repo}/git/commits/${latestCommitSha}`,
    );

    // 3. Create blobs for all files
    const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];

    const BLOB_CONCURRENCY = 10;
    for (let i = 0; i < files.length; i += BLOB_CONCURRENCY) {
      const batch = files.slice(i, i + BLOB_CONCURRENCY);
      const blobResults = await Promise.all(
        batch.map(async (file) => {
          const blob = await this.request<{ sha: string }>(
            `/repos/${owner}/${repo}/git/blobs`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                content: file.content,
                encoding: "utf-8",
              }),
            },
          );
          return { path: file.path, sha: blob.sha };
        }),
      );

      for (const result of blobResults) {
        treeItems.push({
          path: result.path,
          mode: "100644",
          type: "blob",
          sha: result.sha,
        });
      }
    }

    // 4. Create a new tree
    const newTree = await this.request<GitHubCreateTreeResponse>(
      `/repos/${owner}/${repo}/git/trees`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_tree: latestCommit.tree.sha,
          tree: treeItems,
        }),
      },
    );

    // 5. Create a new commit
    const newCommit = await this.request<GitHubCommitResponse>(
      `/repos/${owner}/${repo}/git/commits`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [latestCommitSha],
        }),
      },
    );

    // 6. Update the branch reference
    await this.request(
      `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommit.sha }),
      },
    );

    return {
      commitSha: newCommit.sha,
      repoUrl: repoInfo.html_url,
    };
  }
}

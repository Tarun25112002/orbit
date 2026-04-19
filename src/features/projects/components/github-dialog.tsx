"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { GithubIcon, ExternalLinkIcon, DownloadCloudIcon, UploadCloudIcon } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "convex/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

type GitHubUser = {
  login: string;
  avatar_url: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
};

/**
 * Shared hook for GitHub connection state.
 * Re-checks whenever the Clerk user changes or after OAuth redirect.
 */
function useGitHubConnection() {
  const { user: clerkUser, isLoaded: isClerkLoaded } = useUser();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  const checkConnection = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/github/connection", { cache: "no-store" });
      const data = await res.json();
      if (data.connected && data.user) {
        setGhUser(data.user);
      } else {
        setGhUser(null);
      }
    } catch {
      setGhUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-check when Clerk user changes (login, logout, switch)
  useEffect(() => {
    if (!isClerkLoaded) return;

    const currentId = clerkUser?.id ?? null;

    // If user switched or signed out, clear immediately before fetching
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== currentId) {
      setGhUser(null);
    }
    prevUserIdRef.current = currentId;

    if (currentId) {
      checkConnection();
    } else {
      setGhUser(null);
      setLoading(false);
    }
  }, [isClerkLoaded, clerkUser?.id, checkConnection]);

  // Re-check after GitHub OAuth redirect (github_connected=1 in URL)
  useEffect(() => {
    const connected = searchParams.get("github_connected");
    if (connected === "1") {
      checkConnection();
    }
  }, [searchParams, checkConnection]);

  return { ghUser, loading: !isClerkLoaded || loading, checkConnection };
}

export function GitHubConnectButton() {
  const { ghUser, loading, checkConnection } = useGitHubConnection();

  const handleConnect = () => {
    const currentPath = window.location.pathname;
    window.location.href = `/api/auth/github/connect?redirect=${encodeURIComponent(currentPath)}`;
  };

  const handleDisconnect = async () => {
    try {
      await fetch("/api/auth/github/disconnect", { method: "POST" });
      toast.success("GitHub account disconnected");
      // Re-check connection state immediately
      await checkConnection();
    } catch {
      toast.error("Failed to disconnect GitHub");
    }
  };

  if (loading) {
    return <Spinner className="size-4" />;
  }

  if (ghUser) {
    return (
      <div className="flex items-center gap-2">
        <img
          src={ghUser.avatar_url}
          alt={ghUser.login}
          className="size-5 rounded-full"
        />
        <span className="text-sm font-medium">{ghUser.login}</span>
        <Button variant="ghost" size="sm" onClick={handleDisconnect} className="h-6 px-2 text-[10px]">
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleConnect} className="gap-2">
      <GithubIcon className="size-4" />
      Connect GitHub
    </Button>
  );
}

export function GitHubDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const project = useQuery(api.projects.getById, { id: projectId });
  const [view, setView] = useState<"menu" | "import" | "export">("menu");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  
  // Import state
  const [selectedRepo, setSelectedRepo] = useState("");
  const [importing, setImporting] = useState(false);

  // Export state
  const [exportName, setExportName] = useState(project?.name || "");
  const [exporting, setExporting] = useState(false);

  // Push state
  const [pushing, setPushing] = useState(false);

  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/github/repos", { cache: "no-store" });
      if (res.status === 401) {
        toast.error("GitHub not connected. Please connect your account first.");
        return;
      }
      const data = await res.json();
      if (data.repos) {
        setRepos(data.repos);
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch {
      toast.error("Failed to fetch repositories");
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleImportClick = () => {
    setView("import");
    fetchRepos();
  };

  const handleExportClick = () => {
    setView("export");
    setExportName(project?.name || "");
  };

  const handleImport = async () => {
    if (!selectedRepo) return;
    const repoObj = repos.find((r) => r.full_name === selectedRepo);
    if (!repoObj) return;

    const [owner, name] = repoObj.full_name.split("/");
    
    setImporting(true);
    const loadingToast = toast.loading("Importing repository...");
    
    try {
      const res = await fetch("/api/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          owner,
          repo: name,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast.success(`Imported ${data.filesImported} files!`, { id: loadingToast });
        onOpenChange(false);
      } else {
        toast.error(data.error || "Import failed", { id: loadingToast });
      }
    } catch {
      toast.error("An unexpected error occurred", { id: loadingToast });
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    if (!exportName.trim()) return;
    
    setExporting(true);
    const loadingToast = toast.loading("Creating repository and pushing files...");
    
    try {
      const res = await fetch("/api/github/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          repoName: exportName,
          isPrivate: false,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast.success(`Exported! Repository created at ${data.repoUrl}`, { id: loadingToast });
        onOpenChange(false);
      } else {
        toast.error(data.error || "Export failed", { id: loadingToast });
      }
    } catch {
      toast.error("An unexpected error occurred", { id: loadingToast });
    } finally {
      setExporting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    const loadingToast = toast.loading("Pushing updates to GitHub...");
    
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast.success(`Pushed ${data.filesPushed} files successfully!`, { id: loadingToast });
        onOpenChange(false);
      } else {
        toast.error(data.error || "Push failed", { id: loadingToast });
      }
    } catch {
      toast.error("An unexpected error occurred", { id: loadingToast });
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      onOpenChange(val);
      if (!val) setTimeout(() => setView("menu"), 200);
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GithubIcon className="size-5" />
            GitHub Integration
          </DialogTitle>
          <DialogDescription>
            {view === "menu" && "Import from or export to GitHub."}
            {view === "import" && "Select a repository to import into this project."}
            {view === "export" && "Create a new GitHub repository from this project."}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="mb-6 flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-sm font-medium text-foreground">Status</span>
            <GitHubConnectButton />
          </div>

          {view === "menu" && (
            <div className="grid gap-3">
              {(project?.importRepoUrl || project?.exportRepoUrl) ? (
                <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p className="mb-2 font-medium">Currently linked to:</p>
                  <a 
                    href={project.exportRepoUrl || project.importRepoUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline font-mono text-xs"
                  >
                    {project.exportRepoUrl || project.importRepoUrl}
                    <ExternalLinkIcon className="size-3" />
                  </a>
                  
                  <Button 
                    className="mt-4 w-full gap-2" 
                    onClick={handlePush}
                    disabled={pushing}
                  >
                    {pushing ? <Spinner className="size-4" /> : <UploadCloudIcon className="size-4" />}
                    Push Updates to GitHub
                  </Button>
                </div>
              ) : null}

              <Button
                variant="outline"
                className="h-14 justify-start gap-3"
                onClick={handleImportClick}
              >
                <DownloadCloudIcon className="size-5 text-muted-foreground" />
                <div className="flex flex-col items-start text-left">
                  <span className="font-medium">Import Repository</span>
                  <span className="text-xs text-muted-foreground">
                    Clone an existing repo into this workspace
                  </span>
                </div>
              </Button>

              <Button
                variant="outline"
                className="h-14 justify-start gap-3"
                onClick={handleExportClick}
              >
                <UploadCloudIcon className="size-5 text-muted-foreground" />
                <div className="flex flex-col items-start text-left">
                  <span className="font-medium">Export Project</span>
                  <span className="text-xs text-muted-foreground">
                    Create a new GitHub repository with these files
                  </span>
                </div>
              </Button>
            </div>
          )}

          {view === "import" && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label>Select Repository</Label>
                {loadingRepos ? (
                  <div className="flex h-10 w-full items-center justify-center rounded-md border border-input">
                    <Spinner className="size-4" />
                  </div>
                ) : (
                  <select 
                    title="Select Repository"
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                  >
                    <option value="" disabled>Choose a repository...</option>
                    {repos.map((repo) => (
                      <option key={repo.id} value={repo.full_name}>
                        {repo.full_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {view === "export" && (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label>Repository Name</Label>
                <Input
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="my-awesome-project"
                />
                <p className="text-xs text-muted-foreground">
                  A new public repository will be created.
                </p>
              </div>
            </div>
          )}
        </div>

        {view !== "menu" && (
          <DialogFooter className="flex sm:justify-between">
            <Button variant="ghost" onClick={() => setView("menu")} disabled={importing || exporting}>
              Back
            </Button>
            {view === "import" && (
              <Button onClick={handleImport} disabled={!selectedRepo || importing}>
                {importing && <Spinner className="mr-2 size-4" />}
                Import
              </Button>
            )}
            {view === "export" && (
              <Button onClick={handleExport} disabled={!exportName.trim() || exporting}>
                {exporting && <Spinner className="mr-2 size-4" />}
                Export
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useState } from "react";
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

export function GitHubConnectButton() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    fetch("/api/github/connection")
      .then((res) => res.json())
      .then((data) => {
        if (data.connected && data.user) {
          setUser(data.user);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleConnect = () => {
    // Generate a random state to deter CSRF if they care, but simpler is just sending to auth callback route
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "Ov23liI9ATfQSAf59Szj"}&scope=repo&redirect_uri=${window.location.origin}/api/auth/github/callback`;
  };

  const handleDisconnect = async () => {
    await fetch("/api/auth/github/disconnect", { method: "POST" });
    setUser(null);
    window.location.reload();
  };

  if (loading) {
    return <Spinner className="size-4" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <img
          src={user.avatar_url}
          alt={user.login}
          className="size-5 rounded-full"
        />
        <span className="text-sm font-medium">{user.login}</span>
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
      const res = await fetch("/api/github/repos");
      const data = await res.json();
      if (data.repos) {
        setRepos(data.repos);
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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

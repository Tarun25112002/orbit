"use client";

import { useEffect, useState, useCallback } from "react";
import { UserButton } from "@clerk/nextjs";
import { Plus, Search, Blocks, Sparkles, Zap } from "lucide-react";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { Kbd } from "@/components/ui/kbd";

import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ProjectsList } from "./projects-list";
import { UpgradeLimitModal } from "./upgrade-limit-modal";
import { useCreateProject, useProjects } from "../hooks/use-projects";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { cn } from "@/lib/utils";

const FREE_PROJECT_LIMIT = 3;

export const ProjectsView = () => {
  const createProject = useCreateProject();
  const projects = useProjects();
  const activeSub = useQuery(api.subscriptions.getActive);
  const [commandOpen, setCommandOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const isSubscribed = !!activeSub;
  const projectCount = projects?.length ?? 0;

  let projectLimit = 3;
  if (isSubscribed) {
    if (activeSub.tier === "basic") projectLimit = 10;
    if (activeSub.tier === "pro") projectLimit = 50;
    if (activeSub.tier === "advance") projectLimit = Infinity;
  }

  const isUnlimited = projectLimit === Infinity;

  const usagePercent = isUnlimited
    ? 0
    : Math.min(100, (projectCount / projectLimit) * 100);

  const creditsLeft = isUnlimited
    ? Infinity
    : Math.max(0, projectLimit - projectCount);

  const handleNewProject = useCallback(async () => {
    if (projectCount >= projectLimit) {
      setUpgradeOpen(true);
      return;
    }

    const projectName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      separator: "_",
      length: 3,
    });

    try {
      await createProject({ name: projectName });
    } catch (err: any) {
      const isLimitReached = 
        err?.message?.includes("PROJECT_LIMIT_REACHED") ||
        err?.data === "PROJECT_LIMIT_REACHED";

      if (isLimitReached) {
        setUpgradeOpen(true);
      } else {
        console.error("Failed to create project:", err);
      }
    }
  }, [createProject, projectCount, projectLimit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isCmdOrCtrl && key === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }

      if (isCmdOrCtrl && key === "j") {
        event.preventDefault();
        handleNewProject();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewProject]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      {/* Static Background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute inset-x-0 bottom-0 top-[20%] z-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute left-1/2 top-0 -ml-[50%] -mt-[10%] h-[600px] w-[1000px] rounded-full bg-primary/5 opacity-50 blur-[100px] pointer-events-none" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-sm bg-foreground flex items-center justify-center">
            <span className="text-background font-mono font-bold">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
          {isSubscribed && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {activeSub.tier} Plan
            </span>
          )}
        </div>

        <div className="flex items-center space-x-4 font-mono text-sm">
          <UserButton />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-6 mt-[-5vh]">
        <div className="w-full max-w-lg">
          <div className="flex flex-col items-center gap-8">
            <div className="space-y-3 text-center orbit-fade-up">
              <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
                <Blocks className="size-3.5 mr-2" />
                Workspace
              </span>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
                Launch your next idea.
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-md mx-auto">
                Create a new agentic workspace or jump right back into an
                existing one.
              </p>
            </div>

            <div className="w-full overflow-hidden rounded-[20px] border border-border/80 bg-card/40 shadow-2xl backdrop-blur-xl orbit-scale-in">
              <div className="p-2 pb-0">
                <button
                  onClick={handleNewProject}
                  className="group flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-all duration-300 hover:bg-foreground hover:text-background"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-colors duration-300 group-hover:bg-background group-hover:text-foreground">
                    <Plus className="size-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="text-base font-semibold">New Project</span>
                    <p className="text-xs text-muted-foreground group-hover:text-background/70 transition-colors mt-0.5">
                      Scaffold an application instantly
                    </p>
                  </div>

                  <Kbd className="font-mono text-xs opacity-50 group-hover:text-background transition-all group-hover:border-background/20 group-hover:bg-background/10">
                    ⌘J
                  </Kbd>
                </button>
              </div>

              <div className="px-3 py-2">
                <button
                  onClick={() => setCommandOpen(true)}
                  className="group flex w-full items-center gap-3 rounded-xl border border-transparent bg-muted/30 px-4 py-2.5 text-left transition-all duration-200 hover:border-border hover:bg-muted/60"
                >
                  <Search className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />

                  <span className="flex-1 text-[13px] text-muted-foreground transition-colors group-hover:text-foreground">
                    Quick search projects…
                  </span>

                  <Kbd className="h-5 font-mono text-[10px] opacity-60">⌘K</Kbd>
                </button>
              </div>

              <div className="border-t border-border/50" />

              <div className="p-2">
                <ProjectsList onViewAll={() => setCommandOpen(true)} />
              </div>

              {/* AI Usage Bar */}
              <div className="border-t border-border/50" />
              <div className="px-4 py-3">
                {isUnlimited ? (
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-full bg-emerald-500/10 p-1.5">
                      <Zap className="size-3.5 text-emerald-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-foreground">
                          {activeSub?.tier.charAt(0).toUpperCase()}{activeSub?.tier.slice(1)} Plan
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                          Active
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Unlimited AI projects
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="rounded-full bg-primary/10 p-1.5">
                          <Sparkles className="size-3.5 text-primary" />
                        </div>
                        <span className="text-[12px] font-semibold text-foreground">
                          {isSubscribed ? `${activeSub?.tier.charAt(0).toUpperCase()}${activeSub?.tier.slice(1)} Usage` : "AI Usage"}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {projectCount} / {projectLimit} projects
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          usagePercent >= 100
                            ? "bg-red-500"
                            : usagePercent >= 66
                              ? "bg-amber-500"
                              : "bg-primary"
                        )}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {creditsLeft > 0
                        ? `${creditsLeft} AI project${creditsLeft !== 1 ? "s" : ""} remaining`
                        : "Limit Reached — "}
                      {creditsLeft === 0 && (
                        <button
                          onClick={() => setUpgradeOpen(true)}
                          className="text-primary font-semibold hover:underline"
                        >
                          Upgrade Now
                        </button>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <ProjectsCommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
      <UpgradeLimitModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
};

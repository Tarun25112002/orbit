"use client";

import { useEffect, useState, useCallback } from "react";
import { UserButton } from "@clerk/nextjs";
import { Plus, Search } from "lucide-react";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ProjectsList } from "./projects-list";
import { useCreateProject } from "../hooks/use-projects";

export const ProjectsView = () => {
  const createProject = useCreateProject();
  const [commandOpen, setCommandOpen] = useState(false);

  const handleNewProject = useCallback(async () => {
    const projectName = uniqueNamesGenerator({
      dictionaries: [adjectives, animals, colors],
      separator: "_",
      length: 3,
    });

    await createProject({ name: projectName });
  }, [createProject]);

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
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* subtle dot grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.6562 0.1826 262.74 / 0.06) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* top glow — softer */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-48 w-[520px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at top, oklch(0.6562 0.1826 262.74 / 0.08) 0%, transparent 70%)",
        }}
      />

      {/* header */}
      <header className="relative z-10 flex items-center justify-between border-b border-white/[0.04] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg border border-ring/20 bg-ring/8">
            <div className="size-2.5 rounded-[4px] bg-ring/70" />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            Orbit
          </span>
        </div>

        <UserButton />
      </header>

      {/* main */}
      <main className="relative z-10 flex min-h-[calc(100vh-57px)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-3 duration-500">
          <div className="flex flex-col items-center gap-8">
            {/* hero */}
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                What are you building?
              </h1>
              <p className="text-sm text-muted-foreground">
                Start a new project or continue where you left off.
              </p>
            </div>

            {/* actions */}
            <div className="flex w-full flex-col gap-1.5">
              <button
                onClick={handleNewProject}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200",
                  "border-ring/20 bg-ring/[0.04] hover:border-ring/35 hover:bg-ring/[0.08]",
                  "hover:shadow-[0_0_24px_oklch(0.6562_0.1826_262.74/0.06)]",
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-ring/20 bg-ring/10">
                  <Plus className="size-4 text-ring/80" />
                </div>

                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">
                    New project
                  </span>
                </div>

                <Kbd className="font-mono text-[10px] opacity-50 transition-opacity group-hover:opacity-80">
                  ⌘J
                </Kbd>
              </button>

              <button
                onClick={() => setCommandOpen(true)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all duration-200",
                  "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.1] hover:bg-white/[0.04]",
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03]">
                  <Search className="size-3.5 text-muted-foreground/70" />
                </div>

                <span className="text-sm text-muted-foreground/80">
                  Search projects…
                </span>

                <Kbd className="ml-auto font-mono text-[10px] opacity-50 transition-opacity group-hover:opacity-80">
                  ⌘K
                </Kbd>
              </button>
            </div>

            {/* project list */}
            <div className="w-full">
              <ProjectsList onViewAll={() => setCommandOpen(true)} />
            </div>
          </div>
        </div>
      </main>

      <ProjectsCommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
};

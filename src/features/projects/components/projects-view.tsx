"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { Plus, Search } from "lucide-react";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.92 0 0 / 0.06) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-48 w-130 -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at top, oklch(0.98 0 0 / 0.08) 0%, transparent 70%)",
        }}
      />

      <header className="relative z-10 flex items-center justify-between border-b border-white/4 px-5 py-3">
        <Image
          src="/orbit logo.svg"
          alt="Orbit"
          width={80}
          height={24}
          className="grayscale brightness-95 contrast-125"
          priority
        />
        <UserButton />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-6 pt-16">
        <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-3 duration-500">
          <div className="flex flex-col items-center gap-8">
            <div className="space-y-2 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                What are you building?
              </h1>
              <p className="text-sm text-muted-foreground">
                Start a new project or continue where you left off.
              </p>
            </div>

            <div className="w-full overflow-hidden rounded-2xl border border-white/8 bg-white/2 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-sm">
              <div className="p-1.5 pb-0">
                <button
                  onClick={handleNewProject}
                  className="group flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors duration-200 hover:bg-ring/8"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-ring/20 bg-ring/10">
                    <Plus className="size-4 text-ring/80" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground">
                      New project
                    </span>
                  </div>

                  <Kbd className="font-mono text-[10px] opacity-40 transition-opacity group-hover:opacity-80">
                    ⌘J
                  </Kbd>
                </button>
              </div>

              <div className="px-3 py-1.5">
                <button
                  onClick={() => setCommandOpen(true)}
                  className="group flex w-full items-center gap-2.5 rounded-lg border border-white/6 bg-white/3 px-3 py-2 text-left transition-colors duration-200 hover:border-white/12 hover:bg-white/5"
                >
                  <Search className="size-3.5 shrink-0 text-muted-foreground/40" />

                  <span className="flex-1 text-[13px] text-muted-foreground/40">
                    Search projects…
                  </span>

                  <Kbd className="h-4.5 font-mono text-[10px] opacity-60">
                    ⌘K
                  </Kbd>
                </button>
              </div>

              <div className="border-t border-white/6" />

              <div className="p-1.5">
                <ProjectsList onViewAll={() => setCommandOpen(true)} />
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="pointer-events-none z-10 flex items-center justify-center overflow-hidden px-4 pb-8">
        <div
          aria-label="Orbit"
          className="flex select-none items-center justify-center gap-[0.14em] text-[clamp(4.5rem,15vw,10rem)] font-semibold leading-none tracking-[-0.04em] text-white/6"
        >
          <span>O</span>
          <span>r</span>
          <span>b</span>
          <span>i</span>
          <span>t</span>
        </div>
      </footer>

      <ProjectsCommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
};

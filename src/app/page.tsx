"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Github, Linkedin, Twitter } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";
import { useAuth, UserButton } from "@clerk/nextjs";
import { useCreateProject } from "@/features/projects/hooks/use-projects";
import { OrbitAnimation } from "@/components/ui/orbit-animation";

const orbitFeatureCards = [
  {
    node: "Node 01",
    title: "Planning",
    description:
      "Map tasks, architecture, and file changes before execution starts.",
    metric: "Structured graph inputs",
  },
  {
    node: "Node 02",
    title: "Generation",
    description:
      "Generate and edit code in-context with workspace-aware AI actions.",
    metric: "Context-native code output",
  },
  {
    node: "Node 03",
    title: "Verification",
    description:
      "Run and validate outputs with consistent build and runtime checks.",
    metric: "Fast iteration loop",
  },
] as const;

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const createProject = useCreateProject();
  const [isCreating, setIsCreating] = useState(false);
  const currentYear = new Date().getFullYear();

  const handleInitialize = async () => {
    if (isCreating) return;

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    setIsCreating(true);

    try {
      const projectName = uniqueNamesGenerator({
        dictionaries: [adjectives, animals, colors],
        separator: "_",
        length: 3,
      });

      const projectId = await createProject({ name: projectName });
      if (projectId) {
        router.push(`/projects/${projectId}`);
      }
    } catch (error) {
      console.error("Failed to create project:", error);
      setIsCreating(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background selection:bg-primary/20">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <OrbitAnimation />
        <div className="absolute inset-x-0 bottom-0 top-[20%] z-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute right-0 top-0 -mr-[50%] -mt-[25%] h-[1000px] w-[1000px] rounded-full bg-primary/5 opacity-50 blur-[100px] pointer-events-none" />
        <div className="absolute left-0 bottom-0 -ml-[50%] -mb-[25%] h-[800px] w-[800px] rounded-full bg-foreground/5 opacity-50 blur-[100px] pointer-events-none" />
      </div>

      <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto w-full">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-sm bg-foreground flex items-center justify-center">
            <span className="text-background font-mono font-bold">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
        </div>

        <div className="flex items-center space-x-4 font-mono text-sm">
          {isLoaded && !isSignedIn && (
            <>
              <Link
                href="/sign-in"
                className="text-muted-foreground hover:text-foreground ml-4"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="px-4 py-1.5 border border-border rounded bg-foreground text-background hover:bg-foreground/90"
              >
                Sign Up
              </Link>
            </>
          )}

          {isLoaded && isSignedIn && (
            <>
              <Link
                href="/dashboard"
                className="px-4 py-2 border border-border rounded hover:bg-foreground hover:text-background"
              >
                Dashboard
              </Link>
              <div className="flex items-center h-full pl-2">
                <UserButton />
              </div>
            </>
          )}
        </div>
      </nav>

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pb-14">
        <div className="mx-auto flex min-h-[66svh] max-w-4xl flex-col items-center justify-center text-center">
          <div className="mb-6">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 font-mono text-xs text-muted-foreground backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
              Orbit Agentic Pipeline v2.0
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/50">
            Code generation,
            <br />
            redefined.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto font-light leading-relaxed">
            A high-performance intelligence layer that automates your
            development pipeline. Experience autonomous, self-healing,
            multi-agent project scaffolding.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleInitialize}
              disabled={isCreating}
              className="group flex items-center justify-center space-x-2 bg-foreground text-background px-8 py-4 rounded-md font-medium disabled:opacity-80 disabled:cursor-not-allowed w-full sm:w-auto transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Initializing...</span>
                </>
              ) : (
                <>
                  <span>Initialize Workspace</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        <section className="mx-auto w-full max-w-6xl pb-8">
          <div className="mb-12 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Orbit Features
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              Graph-style execution flow built for engineers.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              A connected workflow from planning to generation to verification,
              with clear node-level visibility across your build lifecycle.
            </p>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-x-[8%] top-1/2 hidden border-t border-dashed border-border/70 lg:block" />
            <div className="pointer-events-none absolute left-1/2 top-[-14px] hidden h-12 -translate-x-1/2 border-l border-dashed border-border/70 lg:block" />

            <div className="grid gap-4 md:grid-cols-3">
              {orbitFeatureCards.map((card) => (
                <article
                  key={card.node}
                  className="relative overflow-hidden rounded-xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:bg-card/90"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,oklch(0.2_0_0_/_0.08),transparent_48%)]" />
                  <div className="relative">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {card.node}
                      </span>
                      <span className="size-2 rounded-full bg-foreground/60" />
                    </div>

                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {card.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {card.description}
                    </p>

                    <div className="mt-4 border-t border-dashed border-border/70 pt-3 font-mono text-[11px] text-muted-foreground">
                      {card.metric}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mt-auto w-full border-t border-border/70 bg-background/75 px-6 py-6 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-foreground">
                <span className="font-mono text-xs font-bold text-background">
                  O
                </span>
              </div>

              <div>
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  Orbit
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Agentic workspace platform for production-grade shipping.
                </p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground">
              <a
                href="https://www.linkedin.com/in/tarun-kumar-jha-721761248/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Linkedin className="w-4 h-4" />
                LinkedIn
              </a>

              <a
                href="https://x.com/TarunJha2002"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Twitter className="w-4 h-4" />
                X
              </a>

              <a
                href="https://github.com/Tarun25112002"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors flex items-center gap-1.5"
              >
                <Github className="w-4 h-4" />
                GitHub
              </a>
            </div>
          </div>

          <div className="h-px w-full bg-border/70" />

          <div className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>&copy; {currentYear} Orbit. All rights reserved.</span>
            <span>Developed by Tarun Kumar Jha.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Github, Loader2 } from "lucide-react";
import Image from "next/image";
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

const featureCards = [
  {
    id: "agents",
    label: "01",
    title: "Agentic Build Pipeline",
    summary: "Plan, code, run, and repair project work from one focused flow.",
    detail:
      "Orbit coordinates implementation, code quality, architecture checks, and runtime actions so generated work moves through a practical build loop.",
    metric: "Multi-agent",
  },
  {
    id: "workspace",
    label: "02",
    title: "Live Coding Workspace",
    summary: "Edit files, manage project structure, and keep context close.",
    detail:
      "The coding panel brings file navigation, Monaco editing, AI transforms, status metadata, and workspace state into a clean developer surface.",
    metric: "Editor ready",
  },
  {
    id: "runtime",
    label: "03",
    title: "Runtime Preview",
    summary: "Launch app output and inspect logs without leaving the project.",
    detail:
      "Orbit can sync files into a runtime, install dependencies, start dev servers, show previews, and keep terminal output available for diagnosis.",
    metric: "Preview loop",
  },
  {
    id: "github",
    label: "04",
    title: "GitHub Connected",
    summary: "Move from generated workspace to repository handoff faster.",
    detail:
      "Import repositories, export generated work, and keep authenticated GitHub workflows close to the development experience.",
    metric: "Repo flow",
  },
];

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const createProject = useCreateProject();
  const [isCreating, setIsCreating] = useState(false);
  const [flippedFeatureId, setFlippedFeatureId] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<{
    login: string;
    html_url: string;
  } | null>(null);
  const [githubStatus, setGithubStatus] = useState<
    "idle" | "loading" | "connected" | "disconnected"
  >("idle");
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setGithubStatus("idle");
      setGithubUser(null);
      return;
    }

    let isMounted = true;
    setGithubStatus("loading");

    fetch("/api/github/connection")
      .then((res) => res.json())
      .then(
        (data: {
          connected?: boolean;
          user?: { login?: string; html_url?: string };
        }) => {
          if (!isMounted) return;

          if (data.connected && data.user?.login && data.user?.html_url) {
            setGithubUser({
              login: data.user.login,
              html_url: data.user.html_url,
            });
            setGithubStatus("connected");
            return;
          }

          setGithubUser(null);
          setGithubStatus("disconnected");
        },
      )
      .catch(() => {
        if (!isMounted) return;
        setGithubUser(null);
        setGithubStatus("disconnected");
      });

    return () => {
      isMounted = false;
    };
  }, [isLoaded, isSignedIn]);

  const handleConnectGitHub = () => {
    const clientId =
      process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "Ov23liI9ATfQSAf59Szj";
    const redirectUri = `${window.location.origin}/api/auth/github/callback`;
    const returnPath = `${window.location.pathname}${window.location.search}`;

    window.location.href =
      `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(returnPath)}`;
  };

  const handleGitHubAction = () => {
    if (githubStatus === "connected" && githubUser) {
      window.open(githubUser.html_url, "_blank", "noopener,noreferrer");
      return;
    }

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    handleConnectGitHub();
  };

  const handleInitialize = async () => {
    if (isCreating) return;
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
    <div className="relative min-h-screen bg-background overflow-x-hidden selection:bg-primary/20 flex flex-col">
      {/* Static background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        <div className="absolute inset-x-0 bottom-0 top-[20%] z-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        <div className="absolute right-0 top-0 -mr-[50%] -mt-[25%] h-[1000px] w-[1000px] rounded-full bg-primary/5 opacity-50 blur-[100px] pointer-events-none" />
        <div className="absolute left-0 bottom-0 -ml-[50%] -mb-[25%] h-[800px] w-[800px] rounded-full bg-foreground/5 opacity-50 blur-[100px] pointer-events-none" />
      </div>

      <motion.nav
        className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto w-full"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: easeOutExpo }}
      >
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-sm bg-foreground flex items-center justify-center">
            <span className="text-background font-mono font-bold">O</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">Orbit</span>
        </div>

        <div className="flex items-center space-x-4 font-mono text-sm">
          {isLoaded ? (
            githubStatus === "loading" ? (
              <span className="hidden sm:flex items-center space-x-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>GitHub</span>
              </span>
            ) : githubStatus === "connected" && githubUser ? (
              <button
                type="button"
                onClick={handleGitHubAction}
                className="text-muted-foreground hover:text-foreground hidden sm:flex items-center space-x-2"
              >
                <Github className="w-4 h-4" />
                <span>GitHub</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGitHubAction}
                className="text-muted-foreground hover:text-foreground hidden sm:flex items-center space-x-2"
              >
                <Github className="w-4 h-4" />
                <span>Connect GitHub</span>
              </button>
            )
          ) : (
            <span className="hidden sm:flex items-center space-x-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>GitHub</span>
            </span>
          )}

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
      </motion.nav>

      <main className="relative z-10 flex flex-col items-center px-6 pb-20">
        <motion.div
          className="mx-auto flex min-h-[72svh] max-w-4xl flex-col items-center justify-center text-center"
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.72, delay: 0.08, ease: easeOutExpo }}
        >
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
              className="group flex items-center justify-center space-x-2 bg-foreground text-background px-8 py-4 rounded-md font-medium disabled:opacity-80 disabled:cursor-not-allowed w-full sm:w-auto"
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
        </motion.div>

        <motion.section
          className="mx-auto w-full max-w-7xl py-8 sm:py-12"
          initial={{ opacity: 0, y: 36 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.7, ease: easeOutExpo }}
        >
          <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-card p-2">
                <Image
                  src="/apple-touch-icon.png"
                  alt="Orbit mark"
                  fill
                  sizes="48px"
                  className="object-contain p-1"
                  priority={false}
                />
              </div>
              <div className="max-w-2xl">
                <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Orbit Features
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Flip through the core workflow.
                </h2>
              </div>
            </div>
            <p className="max-w-sm font-mono text-xs leading-relaxed text-muted-foreground sm:text-right">
              Tap or click a card to reveal the operational detail behind each
              Orbit feature.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {featureCards.map((feature, index) => {
              const isFlipped = flippedFeatureId === feature.id;

              return (
                <motion.button
                  key={feature.id}
                  type="button"
                  aria-pressed={isFlipped}
                  onClick={() =>
                    setFlippedFeatureId((current) =>
                      current === feature.id ? null : feature.id,
                    )
                  }
                  className="h-[260px] w-full text-left [perspective:1200px]"
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{
                    duration: 0.52,
                    delay: index * 0.08,
                    ease: easeOutExpo,
                  }}
                >
                  <motion.span
                    className="relative block h-full w-full [transform-style:preserve-3d]"
                    animate={{ rotateY: isFlipped ? 180 : 0 }}
                    transition={{ duration: 0.58, ease: "easeInOut" }}
                  >
                    <span className="orbit-feature-card-face absolute inset-0 flex h-full flex-col justify-between rounded-md border border-border/80 bg-card p-5 shadow-sm">
                      <span>
                        <span className="mb-6 flex items-center justify-between">
                          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {feature.label}
                          </span>
                          <span className="rounded border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            {feature.metric}
                          </span>
                        </span>
                        <span className="block text-xl font-semibold tracking-tight text-foreground">
                          {feature.title}
                        </span>
                        <span className="mt-3 block text-sm leading-6 text-muted-foreground">
                          {feature.summary}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        Click to flip
                      </span>
                    </span>

                    <span className="orbit-feature-card-face absolute inset-0 flex h-full flex-col justify-between rounded-md border border-foreground/20 bg-foreground p-5 text-background shadow-sm [transform:rotateY(180deg)]">
                      <span>
                        <span className="mb-6 flex items-center justify-between">
                          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-background/70">
                            {feature.label}
                          </span>
                          <span className="rounded border border-background/20 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-background/70">
                            Detail
                          </span>
                        </span>
                        <span className="block text-xl font-semibold tracking-tight">
                          {feature.title}
                        </span>
                        <span className="mt-3 block text-sm leading-6 text-background/75">
                          {feature.detail}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-background/65">
                        Click to return
                      </span>
                    </span>
                  </motion.span>
                </motion.button>
              );
            })}
          </div>
        </motion.section>
      </main>

      <motion.footer
        className="relative z-10 mt-auto w-full border-t border-border/70 bg-background/70 px-6 py-6 backdrop-blur-sm"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.6, ease: easeOutExpo }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-foreground">
                <span className="font-mono text-xs font-bold text-background">
                  O
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold tracking-tight text-foreground">
                  Orbit
                </p>
                <p className="max-w-xs font-mono text-[11px] leading-relaxed text-muted-foreground">
                  Agentic workspaces for faster, more reliable software
                  delivery.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:items-end">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                Developer
              </p>
              <p className="text-sm font-medium tracking-tight text-foreground">
                Tarun Kumar Jha
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono">
                {isLoaded ? (
                  githubStatus === "connected" && githubUser ? (
                    <button
                      type="button"
                      onClick={handleGitHubAction}
                      className="transition-colors hover:text-foreground"
                    >
                      GitHub
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGitHubAction}
                      className="transition-colors hover:text-foreground"
                    >
                      Connect GitHub
                    </button>
                  )
                ) : (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    GitHub
                  </span>
                )}
                <a
                  href="https://www.linkedin.com/in/tarun-kumar-jha-721761248/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-foreground"
                >
                  LinkedIn
                </a>
                <a
                  href="https://x.com/TarunJha2002"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-foreground"
                >
                  X
                </a>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground/80">
                Pipeline v2.0
              </span>
            </div>
          </div>

          <div className="h-px w-full bg-border/70" />

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/40 p-3 sm:grid-cols-3">
            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                Runtime
              </p>
              <p className="text-xs text-foreground">
                Autonomous multi-agent execution, tuned for rapid iteration.
              </p>
            </div>

            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                Collaboration
              </p>
              <p className="text-xs text-foreground">
                Shared workspaces with instant sync across projects and files.
              </p>
            </div>

            <div className="space-y-1">
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
                Security
              </p>
              <p className="text-xs text-foreground">
                Authenticated sessions and access controls built into every
                workspace.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 font-mono text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>&copy; {currentYear} Orbit. Crafted by Tarun Kumar Jha.</span>
            <span>Secure by default.</span>
          </div>
        </div>
      </motion.footer>
    </div>
  );
}

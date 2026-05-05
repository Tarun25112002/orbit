"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UserButton, useAuth } from "@clerk/nextjs";
import {
  Plus,
  Search,
  Blocks,
  Sparkles,
  Zap,
  ArrowUpRight,
  Command,
  Orbit,
  LayoutDashboard,
} from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  Variants,
} from "framer-motion";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { Kbd } from "@/components/ui/kbd";
import { buttonVariants } from "@/components/ui/button";
import { OrbitAnimation } from "@/components/ui/orbit-animation";

import { ProjectsCommandDialog } from "./projects-command-dialog";
import { ProjectsList } from "./projects-list";
import { UpgradeLimitModal } from "./upgrade-limit-modal";
import { useCreateProject, useProjects } from "../hooks/use-projects";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const FREE_PROJECT_LIMIT = 3;

const container: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

export const ProjectsView = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken } = useAuth();
  const createProject = useCreateProject();
  const projects = useProjects();
  const activeSub = useQuery(api.subscriptions.getActive);
  const [commandOpen, setCommandOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = useMemo(() => !prefersReducedMotion, [prefersReducedMotion]);

  const { scrollYProgress } = useScroll();
  const ambientY = useTransform(scrollYProgress, [0, 0.35], [0, 48]);

  const sessionId = searchParams.get("session_id");
  const paymentStatus = searchParams.get("payment");

  const isSubscribed = !!activeSub;
  const projectCount = projects?.length ?? 0;

  let projectLimit = FREE_PROJECT_LIMIT;
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const data =
        typeof err === "object" && err !== null && "data" in err
          ? (err as { data?: unknown }).data
          : undefined;
      const isLimitReached =
        message.includes("PROJECT_LIMIT_REACHED") ||
        data === "PROJECT_LIMIT_REACHED";

      if (isLimitReached) {
        setUpgradeOpen(true);
      } else {
        console.error("Failed to create project:", err);
      }
    }
  }, [createProject, projectCount, projectLimit]);

  useEffect(() => {
    if (!sessionId || paymentStatus !== "success") {
      return;
    }

    let cancelled = false;

    const syncPayment = async () => {
      try {
        const token = await getToken();
        const headers: HeadersInit = { "Content-Type": "application/json" };

        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch("/api/stripe/sync-session", {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({ sessionId }),
        });

        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          tier?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Failed to confirm payment");
        }

        if (!cancelled) {
          toast.success(
            data.tier
              ? `Payment confirmed. ${data.tier} plan activated.`
              : "Payment confirmed. Plan activated.",
          );
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Payment sync failed";
          toast.error(message);
        }
      } finally {
        if (!cancelled) {
          router.replace("/dashboard");
        }
      }
    };

    void syncPayment();

    return () => {
      cancelled = true;
    };
  }, [getToken, paymentStatus, router, sessionId]);

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
        void handleNewProject();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewProject]);

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background selection:bg-primary/20">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[length:64px_64px] opacity-35 [mask-image:linear-gradient(to_bottom,black_35%,transparent_95%)]"
          style={{
            maskImage: "linear-gradient(to bottom, black 38%, transparent 96%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 38%, transparent 96%)",
          }}
        />
        <div className="orbit-landing-grain absolute inset-0 opacity-50 mix-blend-multiply dark:mix-blend-soft-light" />
        <div className="orbit-aurora-blob-a absolute -left-[18%] top-[6%] h-[480px] w-[480px] rounded-full bg-gradient-to-br from-primary/22 via-transparent to-transparent blur-3xl" />
        <div className="orbit-aurora-blob-b absolute -right-[12%] top-[32%] h-[440px] w-[440px] rounded-full bg-gradient-to-tl from-foreground/[0.06] via-primary/12 to-transparent blur-3xl dark:from-white/[0.05]" />
        <div className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary/[0.07] via-transparent to-transparent dark:from-primary/[0.1]" />
        <motion.div
          className="absolute inset-x-0 bottom-0 z-[1] flex justify-center overflow-hidden opacity-[0.22] dark:opacity-[0.28]"
          style={motionSafe ? { y: ambientY } : undefined}
        >
          <div className="relative h-[min(72vh,640px)] w-[min(120vw,920px)] translate-y-[18%] scale-[0.55] md:scale-[0.62]">
            <OrbitAnimation />
          </div>
        </motion.div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,transparent_40%,var(--background)_78%)]" />
      </div>

      <motion.header
        initial={motionSafe ? { y: -10, opacity: 0 } : false}
        animate={motionSafe ? { y: 0, opacity: 1 } : undefined}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-30 border-b border-border/50 bg-background/75 px-4 py-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 md:px-6"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link
            href="/"
            className="group flex min-w-0 items-center gap-2.5 rounded-lg outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary shadow-sm ring-1 ring-primary/25">
              <span className="font-mono text-sm font-bold text-primary-foreground">
                O
              </span>
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/25 to-transparent opacity-40" />
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="flex items-center gap-1.5 truncate text-base font-semibold tracking-tight text-foreground">
                <LayoutDashboard className="size-4 shrink-0 text-muted-foreground opacity-70" />
                Dashboard
              </span>
              <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                Orbit workspace control
              </span>
            </div>
            {isSubscribed && activeSub && (
              <span className="ml-1 hidden shrink-0 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary sm:inline-flex">
                {activeSub.tier} plan
              </span>
            )}
          </Link>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "hidden font-mono text-xs sm:inline-flex",
              )}
            >
              Home
            </Link>
            <Link
              href="/pricing"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "font-mono text-xs",
              )}
            >
              Plans
            </Link>
            <UserButton />
          </div>
        </div>
      </motion.header>

      <main className="relative z-10 flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 pt-10 md:px-6 md:pb-20 md:pt-14">
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,440px)] xl:gap-16">
            <motion.div
              className="flex flex-col"
              initial={motionSafe ? "hidden" : false}
              animate={motionSafe ? "visible" : undefined}
              variants={motionSafe ? container : undefined}
            >
              <motion.div variants={motionSafe ? item : undefined}>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/50 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground shadow-sm backdrop-blur-sm">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/45 opacity-70" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgb(34,197,94,0.4)]" />
                  </span>
                  Mission control
                </span>
              </motion.div>

              <motion.h1
                variants={motionSafe ? item : undefined}
                className="orbit-hero-gradient-shimmer mt-6 max-w-xl bg-gradient-to-br from-foreground via-foreground to-foreground/55 bg-[length:200%_200%] bg-clip-text text-4xl font-bold leading-[1.08] tracking-tighter text-transparent sm:text-5xl lg:text-[3.25rem]"
              >
                Launch the next
                <span className="bg-gradient-to-r from-foreground via-primary to-foreground/65 bg-[length:180%_auto] bg-clip-text">
                  {" "}
                  orbit.
                </span>
              </motion.h1>

              <motion.p
                variants={motionSafe ? item : undefined}
                className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg"
              >
                Spin up agentic workspaces, search across projects, and jump
                back into execution with one keyboard-native surface.
              </motion.p>

              <motion.div
                variants={motionSafe ? item : undefined}
                className="mt-8 flex flex-wrap gap-2"
              >
                <span className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
                  <Blocks className="size-3.5 text-primary" />
                  {projectCount} workspace{projectCount === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
                  <Orbit className="size-3.5 text-primary" />
                  {isSubscribed && activeSub
                    ? `${activeSub.tier} tier`
                    : "Free tier"}
                </span>
                <span className="inline-flex items-center gap-2 rounded-lg border border-border/70 bg-card/70 px-3 py-2 font-mono text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
                  <Command className="size-3.5 text-primary" />
                  ⌘K search · ⌘J new
                </span>
              </motion.div>

              <motion.div
                variants={motionSafe ? item : undefined}
                className="mt-10 grid gap-3 sm:grid-cols-3"
              >
                {[
                  {
                    t: "Plan",
                    d: "Graph-style intent before files move.",
                  },
                  {
                    t: "Build",
                    d: "Scaffold, edit, and stream progress live.",
                  },
                  {
                    t: "Run",
                    d: "Preview & terminal in one cockpit.",
                  },
                ].map((step) => (
                  <div
                    key={step.t}
                    className="rounded-xl border border-border/60 bg-muted/25 p-4 shadow-sm ring-1 ring-border/30 backdrop-blur-sm transition-colors hover:bg-muted/40"
                  >
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                      {step.t}
                    </p>
                    <p className="mt-2 text-sm leading-snug text-muted-foreground">
                      {step.d}
                    </p>
                  </div>
                ))}
              </motion.div>
            </motion.div>

            <motion.div
              initial={motionSafe ? { opacity: 0, y: 24, scale: 0.98 } : false}
              animate={
                motionSafe
                  ? { opacity: 1, y: 0, scale: 1 }
                  : { opacity: 1, y: 0, scale: 1 }
              }
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
              className="relative w-full lg:justify-self-end"
            >
              <div className="pointer-events-none absolute -inset-4 -z-10 rounded-[28px] bg-gradient-to-br from-primary/15 via-transparent to-transparent blur-2xl" />
              <div className="overflow-hidden rounded-[22px] border border-border/70 bg-card/75 shadow-[0_28px_80px_-36px_rgb(0,0,0,0.45)] ring-1 ring-border/35 backdrop-blur-xl dark:shadow-[0_32px_90px_-40px_rgb(0,0,0,0.65)]">
                <div className="flex items-center justify-between border-b border-border/60 bg-muted/35 px-4 py-3">
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span className="size-2 rounded-full bg-red-400/90" />
                    <span className="size-2 rounded-full bg-amber-400/90" />
                    <span className="size-2 rounded-full bg-emerald-400/90" />
                    <span className="ml-2 truncate">orbit — projects</span>
                  </div>
                  <Link
                    href="/pricing"
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "xs" }),
                      "h-7 gap-1 font-mono text-[10px] text-muted-foreground",
                    )}
                  >
                    Upgrade
                    <ArrowUpRight className="size-3 opacity-70" />
                  </Link>
                </div>

                <div className="p-2 pb-0">
                  <button
                    type="button"
                    onClick={() => void handleNewProject()}
                    className="group flex w-full items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-all duration-300 hover:bg-primary hover:text-primary-foreground"
                  >
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md ring-1 ring-primary/30 transition-all duration-300 group-hover:bg-primary-foreground group-hover:text-primary">
                      <Plus className="size-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <span className="text-base font-semibold tracking-tight">
                        New project
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground transition-colors group-hover:text-primary-foreground/80">
                        Scaffold a workspace in one shot
                      </p>
                    </div>

                    <Kbd className="font-mono text-[10px] opacity-60 transition-all group-hover:border-primary-foreground/25 group-hover:bg-primary-foreground/10 group-hover:text-primary-foreground">
                      ⌘J
                    </Kbd>
                  </button>
                </div>

                <div className="px-2 pb-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setCommandOpen(true)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-border/50 bg-muted/25 px-4 py-2.5 text-left shadow-inner transition-all hover:border-primary/25 hover:bg-muted/50"
                  >
                    <Search className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />

                    <span className="flex-1 text-[13px] text-muted-foreground transition-colors group-hover:text-foreground">
                      Quick search projects…
                    </span>

                    <Kbd className="h-5 font-mono text-[10px] opacity-70">
                      ⌘K
                    </Kbd>
                  </button>
                </div>

                <div className="border-t border-border/50" />

                <div className="p-2">
                  <ProjectsList onViewAll={() => setCommandOpen(true)} />
                </div>

                <div className="border-t border-border/50" />
                <div className="px-4 py-3.5">
                  {isUnlimited ? (
                    <div className="flex items-center gap-2.5">
                      <div className="rounded-full bg-emerald-500/12 p-2 ring-1 ring-emerald-500/25">
                        <Zap className="size-4 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-semibold text-foreground">
                            {activeSub?.tier.charAt(0).toUpperCase()}
                            {activeSub?.tier.slice(1)} plan
                          </span>
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Active
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Unlimited AI projects on this workspace
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="rounded-full bg-primary/12 p-2 ring-1 ring-primary/20">
                            <Sparkles className="size-4 text-primary" />
                          </div>
                          <span className="text-[12px] font-semibold text-foreground">
                            {isSubscribed && activeSub
                              ? `${activeSub.tier.charAt(0).toUpperCase()}${activeSub.tier.slice(1)} usage`
                              : "AI usage"}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] font-medium text-muted-foreground">
                          {projectCount} / {projectLimit}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted/70 ring-1 ring-border/40">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            usagePercent >= 100
                              ? "bg-red-500"
                              : usagePercent >= 66
                                ? "bg-amber-500"
                                : "bg-primary",
                          )}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        {creditsLeft > 0
                          ? `${creditsLeft} AI project${creditsLeft !== 1 ? "s" : ""} remaining on your plan.`
                          : "Limit reached — "}
                        {creditsLeft === 0 && (
                          <button
                            type="button"
                            onClick={() => setUpgradeOpen(true)}
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            Upgrade now
                          </button>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <footer className="relative z-10 border-t border-border/50 bg-muted/25 px-4 py-6 backdrop-blur-md dark:bg-muted/10 md:px-6">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-center font-mono text-[11px] text-muted-foreground sm:flex-row sm:text-left">
            <p>
              <span className="text-foreground/80">Tip:</span> keep this tab
              pinned — Orbit responds to system shortcuts globally here.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-foreground/80 transition-colors hover:text-foreground"
            >
              Back to landing
              <ArrowUpRight className="size-3.5 opacity-70" />
            </Link>
          </div>
        </footer>
      </main>

      <ProjectsCommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
      <UpgradeLimitModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
};

"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  Github,
  Linkedin,
  Twitter,
  Sparkles,
  Terminal,
  Cpu,
  Box,
  Layout,
  Gauge,
  ChevronRight,
} from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
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
import { UpgradeLimitModal } from "@/features/projects/components/upgrade-limit-modal";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const orbitFeatureCards = [
  {
    node: "Node 01",
    title: "Planning",
    description:
      "Map tasks, architecture, and file operations before execution starts.",
    metric: "Structured graph inputs",
    icon: Layout,
    accent:
      "from-indigo-500/15 via-transparent to-purple-500/10 dark:from-indigo-400/10",
  },
  {
    node: "Node 02",
    title: "Generation",
    description:
      "Generate and refine code with workspace-aware context and live progress.",
    metric: "Context-native output",
    icon: Cpu,
    accent:
      "from-emerald-500/12 via-transparent to-teal-500/10 dark:from-emerald-400/8",
  },
  {
    node: "Node 03",
    title: "Verification",
    description:
      "Boot previews, validate installs, and iterate until the runtime is green.",
    metric: "Tight iteration loop",
    icon: Gauge,
    accent:
      "from-amber-500/12 via-transparent to-orange-500/10 dark:from-amber-400/8",
  },
] as const;

const bentoItems = [
  {
    title: "Sandbox runtime",
    body: "Docker-backed workspace with deterministic installs and previews.",
    className: "md:col-span-2 md:row-span-1",
    icon: Box,
  },
  {
    title: "Live pipeline",
    body: "See planning, builds, and execution steps stream in real time.",
    className: "md:col-span-1",
    icon: Terminal,
  },
  {
    title: "Frontend-first DNA",
    body: "Vite + React + TypeScript setups tuned for stellar UI polish.",
    className: "md:col-span-1",
    icon: Sparkles,
  },
] as const;

const heroVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.065,
      delayChildren: 0.08,
    },
  },
};

const heroItem = {
  hidden: { opacity: 0, y: 22 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.16, 1, 0.3, 1],
    },
  },
};

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const createProject = useCreateProject();
  const aiAccess = useQuery(api.projects.checkAiAccess);
  const [isCreating, setIsCreating] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const prefersReducedMotion = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });

  const heroParallaxY = useTransform(scrollYProgress, [0, 1], [0, 80]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0.35]);

  const motionSafe = useMemo(() => !prefersReducedMotion, [prefersReducedMotion]);

  const handleInitialize = async () => {
    if (isCreating) return;

    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    if (aiAccess && !aiAccess.allowed) {
      setUpgradeOpen(true);
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
    } catch (error: unknown) {
      setIsCreating(false);
      const err = error as { message?: string; data?: string };
      const isLimitReached =
        err?.message?.includes("PROJECT_LIMIT_REACHED") ||
        err?.data === "PROJECT_LIMIT_REACHED";

      if (isLimitReached) {
        setUpgradeOpen(true);
      } else {
        console.error("Failed to create project:", error);
      }
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background selection:bg-primary/25">
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[length:72px_72px] opacity-40 mask-[linear-gradient(to_bottom,black_52%,transparent_100%)]"
          style={{
            maskImage:
              "linear-gradient(to bottom, black 42%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 42%, transparent 100%)",
          }}
        />

        <div className="orbit-landing-grain pointer-events-none absolute inset-0 opacity-60 mix-blend-multiply dark:mix-blend-soft-light" />

        <div className="absolute -left-[20%] top-[8%] h-[560px] w-[560px] rounded-full bg-gradient-to-br from-primary/25 via-transparent to-transparent blur-3xl orbit-aurora-blob-a" />
        <div className="absolute -right-[15%] top-[38%] h-[520px] w-[520px] rounded-full bg-gradient-to-tl from-foreground/[0.07] via-primary/15 to-transparent blur-3xl orbit-aurora-blob-b dark:from-white/[0.06]" />

        <div className="absolute inset-x-0 top-0 z-[1] h-[520px] bg-gradient-to-b from-primary/[0.08] via-background/40 to-transparent dark:from-primary/[0.12]" />

        <motion.div
          className="relative z-[1] will-change-transform"
          style={
            motionSafe ? { y: heroParallaxY, opacity: heroOpacity } : undefined
          }
        >
          <OrbitAnimation />
        </motion.div>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,transparent_42%,var(--background)_74%)]" />
      </div>

      <motion.nav
        initial={motionSafe ? { y: -8, opacity: 0 } : false}
        animate={motionSafe ? { y: 0, opacity: 1 } : undefined}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-40 border-b border-border/50 bg-background/70 px-4 py-3 backdrop-blur-xl supports-[backdrop-filter]:bg-background/55 md:px-6"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative flex size-9 items-center justify-center overflow-hidden rounded-lg bg-primary shadow-sm ring-1 ring-primary/25">
              <span className="font-mono text-sm font-bold text-primary-foreground">
                O
              </span>
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-40" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-base font-semibold tracking-tight text-foreground">
                Orbit
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:block">
                Agentic workspace
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2 font-mono text-sm md:gap-3">
            {isLoaded && !isSignedIn && (
              <>
                <Link
                  href="/sign-in"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  Sign in
                </Link>
                <Link href="/sign-up" className={cn(buttonVariants({ size: "sm" }))}>
                  Sign up
                </Link>
              </>
            )}
            {isLoaded && isSignedIn && (
              <>
                <Link
                  href="/dashboard"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "font-mono",
                  )}
                >
                  Dashboard
                </Link>
                <UserButton />
              </>
            )}
          </div>
        </div>
      </motion.nav>

      <main className="relative z-10 flex flex-1 flex-col">
        <section
          ref={heroRef}
          className="relative mx-auto flex w-full max-w-7xl flex-col px-4 pb-20 pt-12 md:px-6 md:pb-28 md:pt-16"
        >
          <motion.div
            className="mx-auto grid w-full gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16"
            initial={motionSafe ? "hidden" : false}
            animate={motionSafe ? "visible" : undefined}
            variants={motionSafe ? heroVariants : undefined}
          >
            <div className="flex flex-col text-center lg:text-left">
              <motion.div variants={motionSafe ? heroItem : undefined}>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm shadow-sm">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/50 opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_14px_rgb(34,197,94,0.45)]" />
                  </span>
                  Live orchestration pipeline
                </span>
              </motion.div>

              <motion.h1
                variants={motionSafe ? heroItem : undefined}
                className="orbit-hero-gradient-shimmer mt-7 bg-gradient-to-br from-foreground via-foreground to-foreground/55 bg-[length:200%_220%] bg-clip-text text-4xl font-bold leading-[1.05] tracking-tighter text-transparent sm:text-6xl lg:text-[3.85rem] lg:leading-[1.02]"
              >
                Build software that
                <br className="hidden sm:block" />
                <span className="bg-gradient-to-r from-foreground via-primary to-foreground/70 bg-[length:200%_auto] bg-clip-text">
                  {" "}
                  feels alive.
                </span>
              </motion.h1>

              <motion.p
                variants={motionSafe ? heroItem : undefined}
                className="mx-auto mt-6 max-w-xl text-lg font-light leading-relaxed text-muted-foreground lg:mx-0 lg:max-w-lg"
              >
                Orbit orchestrates planning, code generation, and runtime
                validation in one cinematic loop—so every project leaves the pad
                with clarity, polish, and momentum.
              </motion.p>

              <motion.div
                variants={motionSafe ? heroItem : undefined}
                className="mx-auto mt-9 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center lg:mx-0 lg:justify-start"
              >
                <Button
                  size="lg"
                  className="h-12 px-8 text-base shadow-lg shadow-primary/15"
                  disabled={isCreating}
                  onClick={handleInitialize}
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Initializing…
                    </>
                  ) : (
                    <>
                      Initialize workspace
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
                <Link
                  href="/pricing"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-12 gap-2 border-border/80 px-8 text-base backdrop-blur-sm",
                  )}
                >
                  View plans
                  <ChevronRight className="size-4 opacity-70" />
                </Link>
              </motion.div>

              <motion.p
                variants={motionSafe ? heroItem : undefined}
                className="mt-5 text-[12px] text-muted-foreground/90"
              >
                No credit card to explore. Sandbox previews and Monaco editor
                included.
              </motion.p>
            </div>

            <motion.div
              variants={motionSafe ? heroItem : undefined}
              className="relative mx-auto w-full max-w-[520px] perspective-[1400px] lg:mr-0 lg:ml-auto lg:max-w-none"
              style={{
                perspective: "1400px",
              }}
            >
              <motion.div
                className="relative"
                animate={
                  motionSafe
                    ? {
                        rotateX: [10, 6, 10],
                        rotateY: [-4, -2, -4],
                      }
                    : undefined
                }
                transition={{
                  duration: 14,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                style={{
                  transformStyle: "preserve-3d",
                }}
              >
                <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-transparent blur-2xl" />
                <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-[0_28px_80px_-28px_rgb(0,0,0,0.45)] ring-1 ring-border/40 backdrop-blur-xl dark:shadow-[0_32px_90px_-32px_rgb(0,0,0,0.75)]">
                  <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                    <span className="size-3 rounded-full bg-red-400/85" />
                    <span className="size-3 rounded-full bg-amber-400/85" />
                    <span className="size-3 rounded-full bg-emerald-400/85" />
                    <span className="ml-2 flex-1 truncate rounded-md bg-background/80 px-3 py-1 text-center font-mono text-[10px] text-muted-foreground shadow-inner ring-1 ring-border/40">
                      orbit-workspace/app — vite dev
                    </span>
                  </div>
                  <div className="grid min-h-[320px] md:grid-cols-[1fr_minmax(0,1.05fr)]">
                    <div className="flex flex-col border-r border-border/50 bg-muted/25 p-3 font-mono text-[11px] text-muted-foreground">
                      <p className="mb-3 font-semibold text-foreground/80">
                        Execution trace
                      </p>
                      <div className="space-y-2">
                        {[
                          { t: "Plan", ok: true },
                          { t: "Scaffold routes", ok: true },
                          { t: "npm install", ok: true },
                          { t: "Dev server bind", ok: false },
                          { t: "Auto-fix preview", ok: true },
                        ].map((row, i) => (
                          <div
                            key={row.t}
                            className={cn(
                              "flex items-center justify-between rounded-md px-2 py-1 ring-1",
                              row.ok
                                ? "bg-background/75 ring-emerald-500/15 text-foreground"
                                : "bg-primary/10 ring-primary/25 text-primary",
                              i === 3 && motionSafe ? "orbit-fade-up" : "",
                            )}
                            style={{
                              animationDelay: i === 3 ? `${120 + i * 40}ms` : undefined,
                            }}
                          >
                            <span>{row.t}</span>
                            <span
                              className={cn(
                                "text-[10px] uppercase",
                                row.ok
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-primary",
                              )}
                            >
                              {row.ok ? "ok" : "retry"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="relative flex flex-col gap-4 bg-[#0c0c0e] p-5 text-[11px] text-zinc-300 md:min-h-[320px]">
                      <pre className="overflow-hidden rounded-lg border border-white/10 bg-black/55 p-3 font-mono text-[11px] leading-relaxed shadow-inner ring-1 ring-white/10">
                        <span className="text-violet-300">{"import "}</span>
                        <span className="text-zinc-200">{'{ Routes } '}</span>
                        <span className="text-violet-300">{"from "}</span>
                        <span className="text-emerald-300">
                          {'"react-router-dom"'}
                        </span>
                        <span className="text-zinc-500">;</span>
                        {"\n\n"}
                        <span className="text-violet-300">{"export default "}</span>
                        <span className="text-amber-200">{"function App"}</span>
                        <span className="text-zinc-200">{"() "}</span>
                        <span className="text-violet-300">{"return "}</span>
                        {"("}
                        {"\n  "}
                        <span className="text-emerald-200">{"<Routes />"}</span>
                        {"\n"}
                        {");"}
                      </pre>
                      <div className="mt-auto rounded-lg border border-white/10 bg-gradient-to-br from-indigo-500/10 to-purple-500/5 px-4 py-3 backdrop-blur-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                          Preview ready
                        </p>
                        <p className="mt-1 text-sm font-medium text-zinc-100">
                          Localhost tunnel connected — scroll the live surface.
                        </p>
                      </div>
                      {motionSafe ? (
                        <motion.div
                          aria-hidden
                          className="pointer-events-none absolute -right-6 top-24 h-32 w-32 rounded-full bg-indigo-500/25 blur-3xl"
                          animate={{
                            opacity: [0.35, 0.65, 0.35],
                            scale: [1, 1.08, 1],
                          }}
                          transition={{
                            duration: 6,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </motion.div>
        </section>

        <section className="relative border-y border-border/50 bg-muted/35 py-16 backdrop-blur-sm dark:bg-muted/20">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,var(--foreground)/[0.04],transparent_55%)]" />
          <div className="relative mx-auto max-w-7xl px-4 md:px-6">
            <div className="mb-12 max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Density without noise
              </p>
              <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Everything the loop needs — nothing you don&apos;t.
              </h2>
              <p className="mt-3 text-muted-foreground">
                Batteries-included flow from first prompt to working preview,
                stitched together with ruthless focus on throughput.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3 md:gap-4">
              {bentoItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.title}
                    initial={motionSafe ? { opacity: 0, y: 16 } : false}
                    whileInView={motionSafe ? { opacity: 1, y: 0 } : undefined}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{
                      duration: 0.5,
                      delay: index * 0.06,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className={cn(
                      "rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm ring-1 ring-border/30 backdrop-blur-md transition-colors hover:bg-card hover:shadow-md",
                      item.className,
                    )}
                  >
                    <div className="mb-4 flex items-center gap-2 text-muted-foreground">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <span className="text-[11px] font-medium uppercase tracking-wider">
                        Capability
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="relative mx-auto w-full max-w-7xl px-4 py-20 md:px-6 md:py-24">
          <div className="mb-14 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Execution orbit
            </p>
            <h2 className="mx-auto mt-2 max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground md:text-[2.15rem]">
              Three nodes. One gravitational pull toward shipped software.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Visibility at every phase—know what ran, why it ran, and what to do
              when the runtime pushes back.
            </p>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute inset-x-[10%] top-[42%] hidden border-t border-dashed border-border md:block" />
            <div className="grid gap-6 md:grid-cols-3 md:gap-5">
              {orbitFeatureCards.map((card, i) => {
                const Icon = card.icon;
                return (
                  <motion.article
                    key={card.node}
                    initial={motionSafe ? { opacity: 0, y: 20 } : false}
                    whileInView={motionSafe ? { opacity: 1, y: 0 } : undefined}
                    viewport={{ once: true, margin: "-32px" }}
                    transition={{
                      duration: 0.5,
                      delay: i * 0.07,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    whileHover={
                      motionSafe
                        ? { y: -4, transition: { duration: 0.25 } }
                        : undefined
                    }
                    className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/75 p-6 shadow-[0_22px_50px_-32px_rgb(0,0,0,0.45)] backdrop-blur-md ring-1 ring-border/35 dark:shadow-none"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background/85 via-transparent to-transparent" />
                    <div
                      className={cn(
                        "pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br blur-3xl opacity-90",
                        card.accent,
                      )}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-muted/70 text-foreground shadow-inner ring-1 ring-border/50">
                          <Icon className="size-[18px]" />
                        </div>
                        <span className="rounded-md border border-border/60 bg-muted/45 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {card.node}
                        </span>
                      </div>
                      <h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {card.description}
                      </p>
                      <div className="mt-5 flex items-center justify-between gap-3 border-t border-dashed border-border/70 pt-4 font-mono text-[11px] text-muted-foreground">
                        <span>{card.metric}</span>
                        <span className="text-foreground">—</span>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </div>

          <motion.div
            initial={motionSafe ? { opacity: 0, y: 12 } : false}
            whileInView={motionSafe ? { opacity: 1, y: 0 } : undefined}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="relative mt-16 overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/15 via-muted/60 to-background p-px shadow-xl ring-1 ring-border/35"
          >
            <div className="rounded-[calc(1rem-1px)] bg-gradient-to-br from-background/95 via-background/90 to-muted/35 px-6 py-10 text-center backdrop-blur-xl md:px-12 md:py-14">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Ready when you are
              </p>
              <p className="mx-auto mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                Drop into a workspace that reacts as fast as your ideas orbit.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button size="lg" className="h-12 px-10" disabled={isCreating} onClick={handleInitialize}>
                  {isCreating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Launching…
                    </>
                  ) : (
                    <>
                      Start building
                      <ArrowRight className="size-4" />
                    </>
                  )}
                </Button>
                <Link
                  href="/sign-up"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "h-12 px-10",
                  )}
                >
                  Create free account
                </Link>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 mt-auto border-t border-border/70 bg-muted/40 px-6 py-10 backdrop-blur-md dark:bg-muted/15">
        <div className="mx-auto flex max-w-7xl flex-col gap-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary shadow-sm ring-1 ring-primary/20">
                <span className="font-mono text-sm font-bold text-primary-foreground">
                  O
                </span>
              </div>
              <div className="max-w-sm space-y-1">
                <p className="text-base font-semibold tracking-tight text-foreground">
                  Orbit
                </p>
                <p className="font-mono text-[12px] leading-relaxed text-muted-foreground">
                  Agentic workspace for frontend teams shipping production-grade
                  experiences—fast.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-4 font-mono text-xs">
              <Link
                href="/pricing"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Pricing
              </Link>
              <a
                href="https://www.linkedin.com/in/tarun-kumar-jha-721761248/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Linkedin className="size-4 shrink-0" />
                LinkedIn
              </a>
              <a
                href="https://x.com/TarunJha2002"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Twitter className="size-4 shrink-0" />
                X
              </a>
              <a
                href="https://github.com/Tarun25112002"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Github className="size-4 shrink-0" />
                GitHub
              </a>
            </div>
          </div>

          <div className="h-px bg-border/80" />

          <div className="flex flex-col gap-3 font-mono text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>© {currentYear} Orbit. All rights reserved.</span>
            <span className="text-muted-foreground/90">
              Developed by Tarun Kumar Jha.
            </span>
          </div>
        </div>
      </footer>

      <UpgradeLimitModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </div>
  );
}

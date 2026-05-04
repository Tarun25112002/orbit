"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BotIcon,
  BracesIcon,
  ChevronRightIcon,
  CpuIcon,
  FileCode2Icon,
  SparklesIcon,
  TerminalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const STREAM_LINES = [
  "→ resolve workspace graph…",
  "→ emit create_file src/App.tsx…",
  "→ run_command npm install…",
  "→ start_background_command dev-server…",
  "→ validate preview tunnel…",
] as const;

const PIPELINE_STEPS = [
  { label: "Plan", icon: SparklesIcon },
  { label: "Generate", icon: BracesIcon },
  { label: "Execute", icon: TerminalIcon },
  { label: "Verify", icon: CpuIcon },
] as const;

const PARTICLE_SEED = Array.from({ length: 36 }, (_, i) => ({
  id: i,
  x: (i * 17 + 13) % 100,
  y: (i * 23 + 7) % 100,
  delay: (i % 8) * 0.12,
  duration: 2.4 + (i % 5) * 0.35,
}));

const MATRIX_CHARS =
  "abcdefghijklmnopqrstuvwxyz0123456789{}[];:=<>/|&*+#$_`~?^%";

const buildColumnStacks = (cols: number, rows: number) =>
  Array.from({ length: cols }, (_, c) => ({
    id: c,
    leftPct: (c / cols) * 100 + 100 / cols / 2,
    duration: 6.5 + (c % 9) * 0.45,
    delay: (c * 0.18) % 2.8,
    opacity: 0.12 + (c % 5) * 0.04,
    stack: Array.from({ length: rows }, (_, r) =>
      MATRIX_CHARS[(c * 17 + r * 31 + (c * r) % 7) % MATRIX_CHARS.length],
    ),
  }));

const TERMINAL_TICKS = [
  "$ orbit agent — patch workspace",
  "  WRITE src/app/page.tsx (+142 −0)",
  "  WRITE src/components/Header.tsx (+88 −0)",
  "  RUN npm install --prefer-offline",
  "  OK dev-server listening :4173",
  "  SYNC preview tunnel…",
] as const;

export type OrbitBuildingAnimationProps = {
  /** `embed` = IDE-style coding overlay; `full` = welcome / preview panels */
  density?: "full" | "embed";
};

function CodeMatrixRain({
  columnCount,
  className,
}: {
  columnCount: number;
  className?: string;
}) {
  const columns = useMemo(
    () => buildColumnStacks(columnCount, 36),
    [columnCount],
  );

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden
    >
      {columns.map((col) => (
        <div
          key={col.id}
          className="absolute top-0 flex h-[200%] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{
            left: `${col.leftPct}%`,
            width: `${100 / columnCount}%`,
            opacity: col.opacity,
          }}
        >
          <motion.div
            className="flex flex-col items-center gap-px font-mono text-[9px] leading-none text-emerald-400 sm:text-[10px]"
            initial={{ y: "0%" }}
            animate={{ y: "-50%" }}
            transition={{
              duration: col.duration,
              repeat: Infinity,
              ease: "linear",
              delay: col.delay,
            }}
          >
            {[0, 1].map((copy) => (
              <div key={copy} className="flex flex-col items-center gap-px">
                {col.stack.map((ch, i) => (
                  <span
                    key={`${copy}-${i}`}
                    className={cn(
                      i % 7 === 0 && "text-emerald-200/90",
                      i % 11 === 0 && "text-cyan-300/70",
                    )}
                  >
                    {ch}
                  </span>
                ))}
              </div>
            ))}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

function EmbedCodingBuild({ motionSafe }: { motionSafe: boolean }) {
  const [tick, setTick] = useState(0);
  const [cursorLine, setCursorLine] = useState(5);

  useEffect(() => {
    if (!motionSafe) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      setCursorLine((n) => (n >= 5 ? 3 : n + 1));
    }, 1400);
    return () => window.clearInterval(id);
  }, [motionSafe]);

  const activeLog = TERMINAL_TICKS[tick % TERMINAL_TICKS.length];

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#010409] font-mono text-foreground"
      role="status"
      aria-live="polite"
      aria-label="AI is building your project"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,oklch(0.72_0.17_160/0.12),transparent_55%)]" />

      {motionSafe ? (
        <CodeMatrixRain columnCount={20} className="opacity-90" />
      ) : null}

      <motion.div
        className="pointer-events-none absolute inset-x-0 top-1/4 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent"
        aria-hidden
        animate={
          motionSafe
            ? { top: ["18%", "78%"], opacity: [0, 0.9, 0] }
            : undefined
        }
        transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between gap-2 rounded-t-lg border border-white/[0.12] bg-[#0d1117]/95 px-3 py-2 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-[#ff5f57]/90" />
              <span className="size-2.5 rounded-full bg-[#febc2e]/90" />
              <span className="size-2.5 rounded-full bg-[#28c840]/90" />
            </span>
            <span className="ml-1 text-[10px] font-medium text-zinc-500 sm:text-[11px]">
              orbit — agent
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/90 sm:text-[11px]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/60 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
            </span>
            BUILDING
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-b-lg border border-t-0 border-white/[0.12] bg-[#0d1117]/90 shadow-inner backdrop-blur-sm">
          <div className="flex w-9 shrink-0 flex-col border-r border-white/[0.06] bg-black/35 py-2 pr-2 text-right text-[10px] leading-[1.65] text-zinc-600 sm:w-10 sm:text-[11px]">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className={cn(
                  "pr-1",
                  cursorLine === n && "text-emerald-500/80",
                )}
              >
                {n}
              </div>
            ))}
          </div>

          <div className="min-w-0 flex-1 overflow-hidden p-2.5 sm:p-3">
            <pre className="text-[10px] leading-[1.65] sm:text-[11px] sm:leading-[1.7]">
              <code className="block text-left">
                <span className="text-purple-400">import</span>{" "}
                <span className="text-sky-300">{"{ useMemo }"}</span>{" "}
                <span className="text-purple-400">from</span>{" "}
                <span className="text-emerald-300">&quot;react&quot;</span>
                {"\n"}
                <span className="text-purple-400">import</span>{" "}
                <span className="text-sky-300">Link</span>{" "}
                <span className="text-purple-400">from</span>{" "}
                <span className="text-emerald-300">&quot;next/link&quot;</span>
                {"\n\n"}
                <span className="text-purple-400">export</span>{" "}
                <span className="text-purple-400">default</span>{" "}
                <span className="text-amber-200">function</span>{" "}
                <span className="text-amber-100">Home</span>
                <span className="text-zinc-500">() {"{"}</span>
                {"\n"}
                <span className="text-zinc-500">{"  "}</span>
                <span className="text-purple-400">return</span>{" "}
                <span className="text-zinc-500">(</span>
                {"\n"}
                <span className="text-zinc-500">{"    "}</span>
                <span className="text-rose-300">&lt;main</span>
                <span className="text-sky-200"> className</span>
                <span className="text-zinc-500">=</span>
                <span className="text-emerald-300">
                  &quot;min-h-dvh bg-zinc-950&quot;
                </span>
                <span className="text-rose-300">&gt;</span>
                {"\n"}
                <span className="text-zinc-500">{"      "}</span>
                <span className="text-zinc-400">{"/* orbit: AI layout */"}</span>
                {"\n"}
                <span
                  className={cn(
                    "relative inline-flex items-center rounded bg-emerald-500/10 px-1",
                    cursorLine === 5 && "ring-1 ring-emerald-500/40",
                  )}
                >
                  <span className="text-zinc-500">{"      "}</span>
                  <span className="text-rose-300">&lt;</span>
                  <span className="text-amber-100">Hero</span>{" "}
                  <span className="text-sky-200">title</span>
                  <span className="text-zinc-500">=</span>
                  <span className="text-emerald-300">&quot;Ship&quot;</span>{" "}
                  <span className="text-rose-300">/&gt;</span>
                  {cursorLine === 5 ? (
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-emerald-400 align-middle" />
                  ) : null}
                </span>
              </code>
            </pre>
          </div>
        </div>

        <div className="mt-2 flex min-h-[4.5rem] flex-col rounded-lg border border-white/[0.1] bg-black/55 shadow-inner">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-1.5 text-[10px] text-zinc-500">
            <TerminalIcon className="size-3 text-emerald-500/80" />
            <span>TERMINAL</span>
            <ChevronRightIcon className="size-3 opacity-50" />
            <span className="truncate text-emerald-500/70">agent stream</span>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden px-2.5 py-2">
            <motion.div
              key={activeLog}
              className="text-[10px] leading-relaxed text-emerald-400/95 sm:text-[11px]"
              initial={motionSafe ? { opacity: 0, x: -6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              {activeLog}
            </motion.div>
            <div className="mt-1 space-y-0.5 text-[9px] text-zinc-600 sm:text-[10px]">
              {STREAM_LINES.slice(0, 3).map((line) => (
                <div key={line} className="truncate opacity-80">
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-zinc-500 sm:text-xs">
          <span className="text-zinc-400">Generating source &amp; wiring runtime</span>
          {" — "}
          <span className="text-emerald-500/80">stay on this tab</span>
        </p>
      </div>
    </div>
  );
}

function EmbedCodingReduced() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-4 border border-white/10 bg-[#0d1117] px-6 py-8 font-mono"
      role="status"
      aria-live="polite"
      aria-label="AI is building your project"
    >
      <TerminalIcon className="size-10 text-emerald-500" />
      <div className="max-w-md text-center">
        <p className="text-base font-semibold tracking-tight text-zinc-100">
          Building your project
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          AI is writing files and configuring the workspace.
        </p>
      </div>
    </div>
  );
}

export const OrbitBuildingAnimation = ({
  density = "full",
}: OrbitBuildingAnimationProps) => {
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = !prefersReducedMotion;
  const isEmbed = density === "embed";

  const particles = useMemo(() => PARTICLE_SEED, []);

  if (prefersReducedMotion) {
    if (isEmbed) {
      return <EmbedCodingReduced />;
    }
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-4 bg-background px-6",
        )}
        role="status"
        aria-live="polite"
        aria-label="AI is building your project"
      >
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-muted/50 shadow-sm">
          <BotIcon className="size-8 text-primary" />
        </div>
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold tracking-tight text-foreground">
            Building your project
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Orbit AI is generating files and configuring the workspace. This may
            take a minute.
          </p>
        </div>
      </div>
    );
  }

  if (isEmbed) {
    return <EmbedCodingBuild motionSafe={motionSafe} />;
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-hidden",
        "bg-gradient-to-b from-background via-background to-muted/25",
      )}
      role="status"
      aria-live="polite"
      aria-label="AI is building your project"
    >
      <CodeMatrixRain
        columnCount={14}
        className="opacity-[0.22] mix-blend-screen dark:opacity-[0.18]"
      />

      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.45]"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,var(--primary)_0%,transparent_55%)] opacity-[0.12]" />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,var(--foreground)/[0.03]_50%,transparent_60%)]" />
      </div>

      <div className="relative flex w-full flex-col items-center py-6">
        <div className="relative flex w-full min-h-[300px] max-h-[52vh] items-center justify-center">
          {motionSafe &&
            particles.map((p) => (
              <motion.span
                key={p.id}
                className="pointer-events-none absolute size-1 rounded-full bg-primary/40 shadow-[0_0_12px_var(--primary)]"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                animate={{
                  opacity: [0.15, 0.85, 0.15],
                  scale: [0.6, 1.15, 0.6],
                }}
                transition={{
                  duration: p.duration,
                  repeat: Infinity,
                  delay: p.delay,
                  ease: "easeInOut",
                }}
              />
            ))}

          <motion.div
            className="pointer-events-none absolute size-[min(85vw,420px)] rounded-full border border-dashed border-primary/15"
            animate={motionSafe ? { rotate: 360 } : undefined}
            transition={{
              duration: 48,
              repeat: Infinity,
              ease: "linear",
            }}
          />
          <motion.div
            className="pointer-events-none absolute size-[min(72vw,340px)] rounded-full border border-primary/20"
            animate={motionSafe ? { rotate: -360 } : undefined}
            transition={{
              duration: 32,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          <motion.div
            className="absolute flex size-[min(58vw,280px)] items-center justify-center rounded-full border border-primary/25 bg-primary/[0.04] shadow-[inset_0_0_60px_var(--primary)/0.08]"
            animate={
              motionSafe
                ? { scale: [1, 1.03, 1], opacity: [0.65, 1, 0.65] }
                : undefined
            }
            transition={{
              duration: 5.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <motion.div
              className="flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-primary via-primary to-primary/70 shadow-[0_0_48px_rgb(99,102,241,0.35)] ring-4 ring-primary/25 ring-offset-4 ring-offset-background md:size-28"
              animate={
                motionSafe
                  ? {
                      boxShadow: [
                        "0 0 32px rgb(99,102,241,0.25)",
                        "0 0 56px rgb(99,102,241,0.45)",
                        "0 0 32px rgb(99,102,241,0.25)",
                      ],
                    }
                  : undefined
              }
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <BotIcon className="size-11 text-primary-foreground drop-shadow-md md:size-12" />
            </motion.div>
          </motion.div>

          {[
            { Icon: TerminalIcon, angle: -90, r: "42%" },
            { Icon: FileCode2Icon, angle: 35, r: "42%" },
            { Icon: BracesIcon, angle: 145, r: "42%" },
            { Icon: SparklesIcon, angle: 215, r: "42%" },
          ].map(({ Icon, angle, r }, idx) => (
            <motion.div
              key={angle}
              className="absolute flex size-10 items-center justify-center rounded-full border border-border/80 bg-card/90 text-primary shadow-lg backdrop-blur-md ring-1 ring-primary/20 md:size-11"
              style={{
                transform: `rotate(${angle}deg) translateY(calc(-1 * ${r})) rotate(${-angle}deg)`,
              }}
              animate={
                motionSafe
                  ? {
                      y: [0, -5, 0],
                      boxShadow: [
                        "0 8px 24px rgb(0,0,0,0.12)",
                        "0 14px 36px rgb(99,102,241,0.2)",
                        "0 8px 24px rgb(0,0,0,0.12)",
                      ],
                    }
                  : undefined
              }
              transition={{
                duration: 3.2 + idx * 0.2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: idx * 0.15,
              }}
            >
              <Icon className="size-4 md:size-[18px]" />
            </motion.div>
          ))}
        </div>

        <div className="relative z-10 mt-2 flex w-full max-w-lg flex-col items-center px-4">
          <div className="mb-4 flex w-full flex-wrap items-center justify-center gap-2">
            {PIPELINE_STEPS.map((step, i) => (
              <motion.div
                key={step.label}
                className="flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shadow-sm backdrop-blur-sm"
                animate={
                  motionSafe
                    ? {
                        borderColor: [
                          "var(--border)",
                          "color-mix(in oklab, var(--primary) 45%, var(--border))",
                          "var(--border)",
                        ],
                        color: [
                          "var(--muted-foreground)",
                          "var(--foreground)",
                          "var(--muted-foreground)",
                        ],
                      }
                    : undefined
                }
                transition={{
                  duration: 2.8,
                  repeat: Infinity,
                  delay: i * 0.45,
                  ease: "easeInOut",
                }}
              >
                <step.icon className="size-3 text-primary" />
                {step.label}
              </motion.div>
            ))}
          </div>

          <motion.h2
            className="text-balance text-center text-2xl font-bold tracking-tight text-foreground md:text-3xl"
            animate={motionSafe ? { opacity: [0.85, 1, 0.85] } : undefined}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            Synthesizing your workspace
          </motion.h2>

          <p className="mt-2 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
            Files, installs, and preview wiring are streaming in. You can keep
            this tab open — we&apos;ll surface the app as soon as the pipeline
            stabilizes.
          </p>

          <div className="relative mt-5 w-full overflow-hidden rounded-xl border border-border/60 bg-black/[0.35] p-3 font-mono text-[11px] leading-relaxed text-emerald-200/90 shadow-inner ring-1 ring-white/10 backdrop-blur-md dark:bg-black/50">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/20" />
            <motion.div
              className="relative space-y-1.5"
              animate={motionSafe ? { y: [0, -56, 0] } : undefined}
              transition={{
                duration: 12,
                repeat: Infinity,
                ease: "linear",
              }}
            >
              {[...STREAM_LINES, ...STREAM_LINES].map((line, i) => (
                <p key={`${line}-${i}`} className="truncate opacity-90">
                  {line}
                </p>
              ))}
            </motion.div>
          </div>

          <div className="relative mt-4 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted/80">
            <motion.div
              className="absolute inset-y-0 w-[40%] rounded-full bg-gradient-to-r from-primary via-indigo-400 to-primary shadow-[0_0_12px_rgb(99,102,241,0.35)]"
              initial={false}
              animate={motionSafe ? { left: ["-40%", "100%"] } : { left: "-40%" }}
              transition={{
                duration: 2.1,
                repeat: Infinity,
                ease: "linear",
              }}
            />
          </div>
        </div>
      </div>

      {motionSafe ? (
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0], y: ["0%", "120%"] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}
    </div>
  );
};

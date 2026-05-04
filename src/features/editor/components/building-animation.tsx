"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  BotIcon,
  BracesIcon,
  FileCode2Icon,
  SparklesIcon,
  TerminalIcon,
  CpuIcon,
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

export type OrbitBuildingAnimationProps = {
  /** `embed` = denser layout for editor overlay; `full` = welcome / preview panels */
  density?: "full" | "embed";
};

export const OrbitBuildingAnimation = ({
  density = "full",
}: OrbitBuildingAnimationProps) => {
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = !prefersReducedMotion;
  const isEmbed = density === "embed";

  const particles = useMemo(() => PARTICLE_SEED, []);

  if (prefersReducedMotion) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-4 bg-background px-6",
          isEmbed && "py-6",
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

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-center overflow-hidden",
        isEmbed
          ? "bg-gradient-to-b from-background/95 via-background to-muted/30"
          : "bg-gradient-to-b from-background via-background to-muted/25",
      )}
      role="status"
      aria-live="polite"
      aria-label="AI is building your project"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.45]"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,var(--primary)_0%,transparent_55%)] opacity-[0.12]" />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,var(--foreground)/[0.03]_50%,transparent_60%)]" />
      </div>

      <div
        className={cn(
          "relative flex w-full flex-col items-center",
          isEmbed ? "max-h-full min-h-0 flex-1 py-4" : "py-6",
        )}
      >
        <div
          className={cn(
            "relative flex w-full items-center justify-center",
            isEmbed ? "min-h-[220px] max-h-[48vh] flex-1" : "min-h-[300px] max-h-[52vh]",
          )}
        >
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
                  ? { boxShadow: ["0 0 32px rgb(99,102,241,0.25)", "0 0 56px rgb(99,102,241,0.45)", "0 0 32px rgb(99,102,241,0.25)"] }
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

        <div
          className={cn(
            "relative z-10 mt-2 flex w-full max-w-lg flex-col items-center px-4",
            isEmbed && "mt-0 max-w-md",
          )}
        >
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
            className={cn(
              "text-balance text-center font-bold tracking-tight text-foreground",
              isEmbed ? "text-xl md:text-2xl" : "text-2xl md:text-3xl",
            )}
            animate={motionSafe ? { opacity: [0.85, 1, 0.85] } : undefined}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            Synthesizing your workspace
          </motion.h2>

          <p
            className={cn(
              "mt-2 max-w-md text-center text-muted-foreground",
              isEmbed ? "text-xs leading-relaxed" : "text-sm leading-relaxed",
            )}
          >
            Files, installs, and preview wiring are streaming in. You can keep
            this tab open — we&apos;ll surface the app as soon as the pipeline
            stabilizes.
          </p>

          <div
            className={cn(
              "relative mt-5 w-full overflow-hidden rounded-xl border border-border/60 bg-black/[0.35] p-3 font-mono text-[11px] leading-relaxed text-emerald-200/90 shadow-inner ring-1 ring-white/10 backdrop-blur-md dark:bg-black/50",
              isEmbed && "mt-4 max-h-[120px] text-[10px]",
            )}
          >
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

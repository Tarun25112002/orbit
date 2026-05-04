"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

const BLOB_SEEDS = [0, 1, 2, 3, 4] as const;

function VibeBlobs({
  motionSafe,
  compact,
}: {
  motionSafe: boolean;
  compact: boolean;
}) {
  const blobs = useMemo(
    () =>
      BLOB_SEEDS.map((i) => ({
        i,
        size: compact ? 140 + (i % 3) * 40 : 180 + (i % 4) * 50,
        x: `${12 + (i * 17) % 76}%`,
        y: `${8 + (i * 23) % 72}%`,
        duration: 14 + i * 2.2,
        delay: i * 0.4,
        hue: [260, 200, 320, 180, 300][i % 5],
      })),
    [compact],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {blobs.map((b) => (
        <motion.div
          key={b.i}
          className="absolute rounded-full opacity-50 blur-3xl dark:opacity-40"
          style={{
            width: b.size,
            height: b.size,
            left: b.x,
            top: b.y,
            marginLeft: -b.size / 2,
            marginTop: -b.size / 2,
            background: `radial-gradient(circle at 30% 30%, oklch(0.72 0.18 ${b.hue} / 0.55), oklch(0.55 0.12 ${b.hue + 40} / 0.25) 45%, transparent 70%)`,
          }}
          animate={
            motionSafe
              ? {
                  scale: [1, 1.12, 0.95, 1],
                  x: ["0%", "3%", "-2%", "0%"],
                  y: ["0%", "-2%", "2%", "0%"],
                }
              : {}
          }
          transition={{
            duration: b.duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: b.delay,
          }}
        />
      ))}
    </div>
  );
}

function SparkleField({ compact }: { compact: boolean }) {
  const dots = useMemo(
    () =>
      Array.from({ length: compact ? 18 : 28 }, (_, i) => ({
        id: i,
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        delay: (i % 7) * 0.35,
        scale: 0.4 + (i % 5) * 0.15,
      })),
    [compact],
  );

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {dots.map((d) => (
        <motion.span
          key={d.id}
          className="absolute size-1 rounded-full bg-white/30 shadow-[0_0_12px_oklch(0.85_0.12_280/0.5)] dark:bg-white/20"
          style={{
            left: d.left,
            top: d.top,
          }}
          initial={{ scale: d.scale }}
          animate={{ opacity: [0.15, 0.85, 0.15] }}
          transition={{
            duration: 2.8 + (d.id % 4) * 0.4,
            repeat: Infinity,
            delay: d.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export type OrbitBuildingAnimationProps = {
  /** `embed` = editor / panel; `full` = welcome / preview */
  density?: "full" | "embed";
};

export const OrbitBuildingAnimation = ({
  density = "full",
}: OrbitBuildingAnimationProps) => {
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = !prefersReducedMotion;
  const compact = density === "embed";

  if (prefersReducedMotion) {
    return (
      <div
        className={cn(
          "relative flex h-full w-full flex-col items-center justify-center gap-4 overflow-hidden bg-gradient-to-br from-violet-950/90 via-background to-cyan-950/40 px-6 text-center",
          compact && "py-6",
        )}
        role="status"
        aria-live="polite"
        aria-label="Working on your project"
      >
        <Sparkles className="size-10 text-primary/80" aria-hidden />
        <p className="max-w-sm text-sm font-medium text-foreground/90">
          Something good is taking shape.
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Hang tight — this can take a moment.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center overflow-hidden bg-zinc-950 text-zinc-100 ring-1 ring-inset ring-white/[0.06]",
        compact ? "rounded-[inherit]" : "",
      )}
      role="status"
      aria-live="polite"
      aria-label="Working on your project"
    >
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "conic-gradient(from 120deg at 50% 50%, oklch(0.45 0.2 280 / 0.35), oklch(0.4 0.14 200 / 0.25), oklch(0.42 0.18 320 / 0.3), oklch(0.45 0.2 280 / 0.35))",
        }}
        animate={motionSafe ? { rotate: [0, 360] } : { rotate: 0 }}
        transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
        aria-hidden
      />

      <VibeBlobs motionSafe={motionSafe} compact={compact} />
      <SparkleField compact={compact} />

      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_40%,transparent_0%,oklch(0.08_0.02_280/0.2)_55%,oklch(0.06_0.02_260/0.92)_100%)]"
        aria-hidden
      />

      <div
        className={cn(
          "relative z-10 flex max-w-md flex-col items-center gap-3 px-4 text-center",
          compact ? "py-4" : "py-8",
        )}
      >
        <motion.div
          className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] shadow-[0_0_40px_-8px_oklch(0.7_0.2_280/0.45)] backdrop-blur-md sm:size-16"
          animate={motionSafe ? { y: [0, -6, 0] } : {}}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkles className="size-7 text-violet-200/90 sm:size-8" aria-hidden />
        </motion.div>

        <motion.h2
          className={cn(
            "font-semibold tracking-tight text-balance text-white/95",
            compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl",
          )}
          animate={motionSafe ? { opacity: [0.85, 1, 0.85] } : {}}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        >
          Vibe coding in progress
        </motion.h2>

        <p
          className={cn(
            "max-w-sm text-pretty text-violet-100/70",
            compact ? "text-xs sm:text-sm" : "text-sm",
          )}
        >
          Flow state engaged — shaping your workspace without the noise of a
          terminal parade.
        </p>

        {motionSafe && (
          <div className="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-cyan-300/80"
                animate={{ scale: [1, 1.5, 1], opacity: [0.35, 1, 0.35] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

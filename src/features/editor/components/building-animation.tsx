"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { BotIcon, TerminalIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const MATRIX_CHARS =
  "abcdefghijklmnopqrstuvwxyz01{}[]<>/;:.=+*#|&$@~^`";

const TERMINAL_LINES = [
  { text: "$ orbit-agent sync --workspace .", dim: false },
  { text: "→ resolving dependency graph…", dim: true },
  { text: "→ write src/App.tsx (diff +142)", dim: true },
  { text: "→ write src/components/Hero.tsx (diff +89)", dim: true },
  { text: "→ run npm install --no-audit", dim: true },
  { text: "✓ lockfile verified", dim: true },
  { text: "→ spawn dev-server (vite)", dim: true },
  { text: "✓ tunnel ready — preview wiring", dim: false },
] as const;

function makeColumnChars(seed: number, len: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    out.push(
      MATRIX_CHARS[(seed * 17 + i * 11 + (i * i) % 7) % MATRIX_CHARS.length] ??
        ".",
    );
  }
  return out;
}

function CodeRain({
  columnCount,
  charPerCol,
  className,
  motionSafe,
}: {
  columnCount: number;
  charPerCol: number;
  className?: string;
  motionSafe: boolean;
}) {
  const columns = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, seed) => ({
        seed,
        chars: makeColumnChars(seed + 1, charPerCol),
        duration: 7 + (seed % 6) * 0.85,
      })),
    [columnCount, charPerCol],
  );

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex justify-between gap-0.5 overflow-hidden font-mono opacity-[0.14] dark:opacity-[0.22]",
        className,
      )}
      aria-hidden
    >
      {columns.map((col) => (
        <div
          key={col.seed}
          className="relative min-w-0 flex-1 overflow-hidden"
        >
          <motion.div
            className="flex flex-col items-center gap-[3px] text-[9px] leading-none text-emerald-600/90 sm:text-[10px] dark:text-emerald-400/80"
            animate={motionSafe ? { y: ["0%", "-50%"] } : { y: "0%" }}
            transition={{
              duration: col.duration,
              repeat: Infinity,
              ease: "linear",
            }}
          >
            {[...col.chars, ...col.chars].map((ch, i) => (
              <span
                key={`${col.seed}-${i}`}
                className={cn(
                  "block select-none",
                  i % 11 === 0 && "text-primary/70 brightness-125",
                )}
              >
                {ch}
              </span>
            ))}
          </motion.div>
        </div>
      ))}
    </div>
  );
}

export type OrbitBuildingAnimationProps = {
  /** `embed` = IDE-style panel for editor overlay; `full` = welcome / preview */
  density?: "full" | "embed";
};

export const OrbitBuildingAnimation = ({
  density = "full",
}: OrbitBuildingAnimationProps) => {
  const prefersReducedMotion = useReducedMotion();
  const motionSafe = !prefersReducedMotion;
  const isEmbed = density === "embed";

  const matrixCols = isEmbed ? 14 : 18;
  const matrixRows = isEmbed ? 36 : 44;

  if (prefersReducedMotion) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-stretch justify-center gap-4 bg-zinc-950 px-4 py-6 text-zinc-100",
          isEmbed && "py-4",
        )}
        role="status"
        aria-live="polite"
        aria-label="AI is building your project"
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 font-mono text-[11px] text-zinc-400">
          <TerminalIcon className="size-3.5 text-emerald-500" />
          <span>orbit-agent</span>
          <span className="text-zinc-600">—</span>
          <span>generating</span>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
          <code>
            <span className="text-violet-400">export</span>{" "}
            <span className="text-sky-300">function</span> App() {"{"}
            {"\n"}
            {"  "}
            <span className="text-violet-400">return</span> (
            {"\n"}
            {"    "}
            <span className="text-emerald-400">&lt;main</span>{" "}
            <span className="text-amber-200/90">className</span>
            <span className="text-zinc-500">=</span>
            <span className="text-amber-200/80">&quot;…&quot;</span>
            <span className="text-emerald-400"> /&gt;</span>
            {"\n"}
            {"  "});{"\n"}
            {"}"}
          </code>
        </pre>
        <div className="max-w-md space-y-1 font-mono text-[11px] text-emerald-600/90 dark:text-emerald-400/90">
          {TERMINAL_LINES.slice(0, 4).map((line) => (
            <p key={line.text} className={line.dim ? "opacity-80" : ""}>
              {line.text}
            </p>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <BotIcon className="size-4 text-primary" />
          Building workspace — this can take a minute.
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100 ring-1 ring-inset ring-white/[0.06]",
        isEmbed ? "rounded-[inherit]" : "",
      )}
      role="status"
      aria-live="polite"
      aria-label="AI is building your project"
    >
      <CodeRain
        columnCount={matrixCols}
        charPerCol={matrixRows}
        motionSafe={motionSafe}
        className="z-0 px-1 pt-12 sm:pt-14"
      />

      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(to_bottom,transparent_0%,oklch(0.12_0_0/0.2)_45%,oklch(0.09_0_0/0.85)_100%)]"
        aria-hidden
      />

      {motionSafe && (
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-[120%] bg-[linear-gradient(to_bottom,transparent_0%,oklch(0.65_0.2_145/0.04)_50%,transparent_100%)]"
          animate={{ y: ["-20%", "100%"] }}
          transition={{ duration: 6.5, repeat: Infinity, ease: "linear" }}
          aria-hidden
        />
      )}

      <div
        className={cn(
          "relative z-10 flex min-h-0 flex-1 flex-col",
          isEmbed ? "p-2 sm:p-3" : "p-4 sm:p-6",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-zinc-800/90 bg-zinc-900/80 px-2 py-1.5 font-mono backdrop-blur-sm sm:px-3 sm:py-2",
            isEmbed ? "rounded-t-md" : "rounded-t-lg",
          )}
        >
          <div className="flex gap-1.5 pr-2" aria-hidden>
            <span className="size-2.5 shrink-0 rounded-full bg-red-500/90 shadow-[0_0_6px_rgba(239,68,68,0.45)]" />
            <span className="size-2.5 shrink-0 rounded-full bg-amber-400/90 shadow-[0_0_6px_rgba(251,191,36,0.35)]" />
            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500/85 shadow-[0_0_6px_rgba(16,185,129,0.35)]" />
          </div>
          <TerminalIcon className="size-3.5 text-emerald-400/90" />
          <span className="min-w-0 truncate text-[10px] font-medium tracking-tight text-zinc-400 sm:text-[11px]">
            orbit-agent —{" "}
            <span className="text-zinc-200">workspace codegen</span>
          </span>
          <motion.span
            className="ml-auto hidden font-mono text-[10px] text-emerald-500/80 sm:inline"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            ● LIVE
          </motion.span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden border-x border-b border-zinc-800/90 bg-zinc-950/90 sm:gap-3">
          <div
            className={cn(
              "relative min-h-[100px] min-w-0 flex-[1.15] overflow-hidden border-b border-zinc-800/80 bg-[#0c0c0f] font-mono sm:min-h-[120px]",
              !isEmbed && "min-h-[140px] flex-[1.05] sm:min-h-[160px]",
            )}
          >
            <div className="flex h-7 shrink-0 items-center gap-0 border-b border-zinc-800/80 bg-zinc-900/60 px-1">
              <span className="rounded-t-md border border-b-0 border-zinc-700 bg-[#0c0c0f] px-2 py-1 text-[10px] text-sky-300/95">
                App.tsx
              </span>
              <span className="px-2 py-1 text-[10px] text-zinc-600">index.css</span>
              <span className="px-2 py-1 text-[10px] text-zinc-600">route.ts</span>
            </div>
            <div className="flex min-h-0 flex-1 overflow-auto">
              <div className="sticky left-0 flex shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900/40 py-2 pr-2 pl-1.5 text-right text-[10px] leading-[1.65] text-zinc-600 select-none">
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <pre className="min-w-0 flex-1 p-2 text-[10px] leading-[1.65] sm:p-3 sm:text-[11px] sm:leading-[1.7]">
                <code className="text-zinc-300">
                  <span className="text-violet-400">export</span>{" "}
                  <span className="text-sky-400">default</span>{" "}
                  <span className="text-sky-300">function</span>{" "}
                  <span className="text-amber-200">App</span>
                  <span className="text-zinc-500">() {"{"}</span>
                  {"\n"}
                  {"  "}
                  <span className="text-violet-400">return</span> (
                  {"\n"}
                  {"    "}
                  <span className="text-emerald-400">&lt;main</span>
                  {"\n"}
                  {"      "}
                  <span className="text-sky-300">className</span>
                  <span className="text-zinc-500">=</span>
                  <span className="text-amber-200/90">
                    &quot;mx-auto max-w-5xl px-4&quot;
                  </span>
                  {"\n"}
                  {"    "}
                  <span className="text-emerald-400">&gt;</span>
                  {"\n"}
                  {"      "}
                  <span className="text-zinc-500">{"/* … */"}</span>
                  {"\n"}
                  {"    "}
                  <span className="text-emerald-400">&lt;/main&gt;</span>
                  {"\n"}
                  {"  "});
                  {"\n"}
                  <span className="text-zinc-500">{"}"}</span>
                  {motionSafe && (
                    <motion.span
                      className="ml-0.5 inline-block h-[1em] w-2 translate-y-0.5 bg-emerald-400/90 align-middle"
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: 0.85, repeat: Infinity }}
                    />
                  )}
                </code>
              </pre>
            </div>
          </div>

          <div
            className="relative flex min-h-[88px] min-w-0 flex-1 flex-col overflow-hidden rounded-b-md bg-black/55 font-mono ring-1 ring-inset ring-emerald-500/10 sm:min-h-[100px]"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-900/50 px-2 py-1 text-[10px] text-zinc-500">
              <span className="text-emerald-500/90">⎿</span>
              <span>TERMINAL</span>
              <span className="text-zinc-600">bash</span>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden px-2 py-2 sm:px-3 sm:py-2.5">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-10 bg-gradient-to-t from-black/90 to-transparent" />
              <motion.div
                className="relative z-0 space-y-1.5 text-[10px] leading-relaxed sm:text-[11px]"
                animate={motionSafe ? { y: [0, -96, 0] } : { y: 0 }}
                transition={{
                  duration: 16,
                  repeat: Infinity,
                  ease: "linear",
                }}
              >
                {[...TERMINAL_LINES, ...TERMINAL_LINES].map((line, i) => (
                  <p
                    key={`${line.text}-${i}`}
                    className={cn(
                      "truncate",
                      line.dim
                        ? "text-emerald-600/75 dark:text-emerald-500/70"
                        : "font-medium text-emerald-400/95",
                    )}
                  >
                    {line.text}
                  </p>
                ))}
              </motion.div>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-zinc-800/80 bg-zinc-900/70 px-2 py-1.5 font-mono text-[10px] text-zinc-500 sm:text-[11px]",
            isEmbed ? "rounded-b-md" : "rounded-b-lg",
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <BotIcon className="size-3 shrink-0 text-primary" />
            <span className="truncate text-zinc-400">
              <span className="text-zinc-300">AI</span> writing files &amp; dev
              server…
            </span>
          </span>
          {motionSafe && (
            <motion.span
              className="shrink-0 tabular-nums text-emerald-500/80"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              BUILD
            </motion.span>
          )}
        </div>
      </div>
    </div>
  );
};

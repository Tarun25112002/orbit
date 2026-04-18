"use client";

import { SparklesIcon } from "lucide-react";
import { type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface EditorSelectionAiBarProps {
  top: number;
  left: number;
  selectedCharCount: number;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onApply: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  isApplying: boolean;
}

export function EditorSelectionAiBar({
  top,
  left,
  selectedCharCount,
  instruction,
  onInstructionChange,
  onApply,
  onKeyDown,
  isApplying,
}: EditorSelectionAiBarProps) {
  if (typeof document === "undefined") {
    return null;
  }

  const clampedLeft = Math.min(
    Math.max(8, left),
    Math.max(8, window.innerWidth - 540),
  );
  const clampedTop = Math.min(
    Math.max(8, top),
    Math.max(8, window.innerHeight - 56),
  );

  return createPortal(
    <div
      className={cn(
        "pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-2 rounded-lg border border-border bg-popover px-2 py-1.5 shadow-lg",
      )}
      style={{
        position: "fixed",
        top: clampedTop,
        left: clampedLeft,
        zIndex: 200,
      }}
      role="dialog"
      aria-label="Edit selection with AI"
    >
      <SparklesIcon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <Input
        value={instruction}
        onChange={(event) => onInstructionChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe what to change..."
        className="h-8 min-w-[220px] flex-1 rounded-md border-border bg-background px-2.5 text-[13px] font-medium text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
        disabled={isApplying}
      />
      <Button
        type="button"
        size="sm"
        disabled={!instruction.trim() || isApplying}
        onClick={() => {
          void onApply();
        }}
        className="h-8 shrink-0 rounded-md px-3 text-[12px] font-medium"
      >
        {isApplying ? (
          <Spinner className="mr-1 size-3.5" />
        ) : (
          <SparklesIcon className="mr-1 size-3.5 text-primary-foreground/90" />
        )}
        Apply
      </Button>
      <div className="hidden items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground/80 sm:flex">
        <span>{selectedCharCount} chars</span>
        <span className="text-muted-foreground/35">|</span>
        <span className="flex items-center gap-1">
          Submit
          <Kbd className="h-4 min-w-[34px] rounded-sm border-border/50 bg-background px-1 text-[9px] font-bold text-muted-foreground shadow-sm">
            Enter
          </Kbd>
        </span>
      </div>
    </div>,
    document.body,
  );
}

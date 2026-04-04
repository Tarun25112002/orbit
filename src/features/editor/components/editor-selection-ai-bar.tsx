"use client";

import { SparklesIcon } from "lucide-react";
import { type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";

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
        "pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-2 rounded-lg border border-[#454545] bg-[#2d2d2d] px-2 py-1.5 shadow-lg",
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
      <Input
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe what to change in selected code"
        className="h-7 min-w-50 flex-1 border-[#3a3a3a] bg-[#1b1b1b] text-xs text-[#d6d6d6] placeholder:text-[#7a7a7a]"
        disabled={isApplying}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!instruction.trim() || isApplying}
        onClick={() => {
          void onApply();
        }}
        className="h-7 shrink-0 border-[#3a3a3a] bg-[#252526] text-[#d0d0d0] hover:bg-[#303031]"
      >
        {isApplying ? (
          <Spinner className="size-3.5" />
        ) : (
          <SparklesIcon className="size-3.5" />
        )}
        Apply
      </Button>
      <div className="hidden items-center gap-1 text-[11px] text-[#8f8f8f] sm:flex">
        <span>{selectedCharCount} chars selected</span>
        <span className="text-[#5f5f5f]">|</span>
        <span>Submit</span>
        <Kbd className="h-4 min-w-4 px-1 text-[10px]">Enter</Kbd>
      </div>
    </div>,
    document.body,
  );
}

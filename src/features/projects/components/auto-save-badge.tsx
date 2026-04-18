"use client";

import {
  CheckIcon,
  Clock3Icon,
  CloudIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AutoSaveStatus =
  | "error"
  | "offline"
  | "saving"
  | "pending"
  | "saved";

export const AutoSaveBadge = ({
  status,
  title,
}: {
  status: AutoSaveStatus;
  title: string;
}) => {
  return (
    <Badge
      variant="outline"
      className={cn(
        "relative px-2.5 py-0.5 ",
        status === "error" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
        status === "offline" &&
          "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
        status === "saving" && "border-sky-500/40 bg-sky-500/10 text-sky-300",
        status === "pending" &&
          "border-amber-500/40 bg-amber-500/10 text-amber-300",
        status === "saved" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
      )}
      title={title}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        {status === "saving" && (
          <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/60" />
        )}
        <CloudIcon
          className={cn(
            "relative z-10 size-4 ",
            status === "saving" && "scale-105",
            status === "saved" && "drop-shadow-[0_0_4px_rgba(16,185,129,0.45)]",
          )}
        />
        {status === "error" ? (
          <XIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-destructive/20 p-0.5" />
        ) : status === "offline" ? (
          <Clock3Icon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-zinc-500/20 p-0.5" />
        ) : status === "saving" ? (
          <LoaderCircleIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 animate-spin rounded-full bg-sky-500/20 p-0.5" />
        ) : status === "pending" ? (
          <Clock3Icon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-amber-500/20 p-0.5" />
        ) : (
          <CheckIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-emerald-500/20 p-0.5" />
        )}
      </span>
    </Badge>
  );
};

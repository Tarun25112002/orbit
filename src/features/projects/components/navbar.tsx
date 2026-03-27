"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import { ChevronRightIcon, ClockIcon, PencilIcon } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

import { Id } from "../../../../convex/_generated/dataModel";
import { useProject, useRenameProject } from "../hooks/use-projects";

interface NavbarProps {
  projectId: Id<"projects">;
}

const LastUpdated = ({ updatedAt }: { updatedAt: number }) => {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
      <ClockIcon className="size-3 shrink-0" />
      {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
    </span>
  );
};

const ProjectNameEditor = ({
  projectId,
  name,
}: {
  projectId: Id<"projects">;
  name: string;
}) => {
  const rename = useRenameProject(projectId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(name);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      await rename({ id: projectId, name: trimmed });
    }
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") cancel();
        }}
        className="h-7 max-w-55 rounded-lg border border-ring/40 bg-white/5 px-2.5 text-sm font-medium text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:border-ring/60 focus:ring-2 focus:ring-ring/20"
        style={{ minWidth: `${Math.max(draft.length, 6) + 4}ch` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="group flex max-w-55 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-foreground/80 transition-colors hover:bg-white/5 hover:text-foreground"
    >
      <span className="truncate">{name}</span>
      <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50" />
    </button>
  );
};

export const Navbar = ({ projectId }: NavbarProps) => {
  const project = useProject(projectId);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/4 bg-background/90 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-1">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-70"
        >
          Orbit
        </Link>

        <ChevronRightIcon className="mx-1 size-3.5 shrink-0 text-muted-foreground/30" />

        {project === undefined ? (
          <div className="px-2">
            <Spinner className="size-3.5 text-ring" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ProjectNameEditor projectId={projectId} name={project.name} />
            <LastUpdated updatedAt={project.updatedAt} />
          </div>
        )}
      </div>

      <UserButton />
    </header>
  );
};

"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { FaGithub } from "react-icons/fa";
import { AlertCircleIcon, Loader2Icon, FolderIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Doc } from "../../../../convex/_generated/dataModel";
import { useProjectsPartial } from "../hooks/use-projects";

interface ProjectsListProps {
  onViewAll: () => void;
}

const formatTimestamp = (timestamp: number) =>
  formatDistanceToNow(new Date(timestamp), { addSuffix: true });

const ProjectIcon = ({
  project,
  className,
}: {
  project: Doc<"projects">;
  className?: string;
}) => {
  const classes = cn("size-4 shrink-0 duration-300", className);

  if (project.importStatus === "completed") {
    return <FaGithub className={classes} />;
  }

  if (project.importStatus === "failed") {
    return <AlertCircleIcon className={cn(classes, "text-destructive")} />;
  }

  if (project.importStatus === "importing") {
    return <Loader2Icon className={cn(classes, "animate-spin")} />;
  }

  return <FolderIcon className={classes} />;
};

const LoadingState = () => {
  return (
    <div className="flex h-[168px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20">
      <Spinner className="size-5 text-primary" />
      <p className="font-mono text-[11px] text-muted-foreground">
        Syncing workspaces…
      </p>
    </div>
  );
};

const EmptyState = () => {
  return (
    <div className="flex h-[168px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 px-4 py-8 text-center transition-colors hover:border-primary/25 hover:from-muted/40">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl border border-border/80 bg-card/90 shadow-sm ring-1 ring-border/40">
        <FolderIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold text-foreground">No projects yet</p>
      <p className="mt-1 max-w-[220px] font-mono text-[11px] leading-relaxed text-muted-foreground">
        Press <span className="text-foreground/90">⌘J</span> to spawn your first
        workspace
      </p>
    </div>
  );
};

const ProjectCard = ({ data }: { data: Doc<"projects"> }) => {
  const href = `/projects/${data._id}`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-all duration-300 hover:border-border/80 hover:bg-muted/45 hover:pl-3.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card/90 shadow-sm ring-1 ring-border/30 transition-all duration-300 group-hover:scale-[1.03] group-hover:border-primary/20 group-hover:shadow-md">
        <ProjectIcon
          project={data}
          className="text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-semibold text-foreground/90 transition-colors group-hover:text-foreground">
            {data.name}
          </div>
          <div className="shrink-0 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            Open →
          </div>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80 transition-colors group-hover:text-muted-foreground">
          {formatTimestamp(data.updatedAt)}
        </div>
      </div>
    </Link>
  );
};

export const ProjectsList = ({ onViewAll }: ProjectsListProps) => {
  const projects = useProjectsPartial(3);

  if (projects === undefined) {
    return <LoadingState />;
  }

  if (projects.length === 0) {
    return <EmptyState />;
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Recent
        </span>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded-md px-2 py-1 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          View all
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {projects.map((project) => (
          <ProjectCard key={project._id} data={project} />
        ))}
      </div>
    </section>
  );
};

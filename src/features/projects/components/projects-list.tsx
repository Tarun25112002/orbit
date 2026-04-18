"use client";

import { formatDistanceToNow } from "date-fns";
import { FaGithub } from "react-icons/fa";
import { AlertCircleIcon, GlobeIcon, Loader2Icon, FolderIcon } from "lucide-react";

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
    <div className="flex h-[150px] items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
};

const EmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-8 text-center h-[150px] transition-colors hover:border-border hover:bg-muted/30">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-background shadow-sm border border-border">
        <FolderIcon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">No projects yet</p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        Press ⌘J to create your first project
      </p>
    </div>
  );
};

const ProjectCard = ({ data }: { data: Doc<"projects"> }) => {
  const href = `/projects/${data._id}`;

  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-300 hover:bg-muted/50 hover:pl-5"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background border border-border shadow-sm transition-all duration-300 group-hover:scale-105 group-hover:border-foreground/20 group-hover:shadow-md">
        <ProjectIcon
          project={data}
          className="text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div className="truncate text-sm font-semibold text-foreground/90 transition-colors group-hover:text-foreground">
            {data.name}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            Open →
          </div>
        </div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground/70 transition-colors group-hover:text-muted-foreground">
          {formatTimestamp(data.updatedAt)}
        </div>
      </div>
    </a>
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
      <div className="flex items-center justify-between px-4 py-2">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent Projects
        </span>
        <button
          onClick={onViewAll}
          className="font-mono text-xs font-medium text-muted-foreground transition-all hover:text-foreground hover:underline underline-offset-4"
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

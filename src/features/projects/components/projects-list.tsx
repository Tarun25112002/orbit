import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FaGithub } from "react-icons/fa";
import {
  AlertCircleIcon,
  GlobeIcon,
  Loader2Icon,
} from "lucide-react";

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
  const classes = cn("size-3.5 shrink-0", className);

  if (project.importStatus === "completed") {
    return <FaGithub className={classes} />;
  }

  if (project.importStatus === "failed") {
    return <AlertCircleIcon className={cn(classes, "text-destructive")} />;
  }

  if (project.importStatus === "importing") {
    return <Loader2Icon className={cn(classes, "animate-spin")} />;
  }

  return <GlobeIcon className={classes} />;
};

const LoadingState = () => {
  return (
    <div className="flex items-center justify-center py-8">
      <Spinner className="size-4 text-ring/60" />
    </div>
  );
};

const EmptyState = () => {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-8 text-center">
      <div className="mb-2.5 flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <GlobeIcon className="size-4 text-muted-foreground/60" />
      </div>
      <p className="text-sm font-medium text-foreground/80">No projects yet</p>
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/60">
        Press ⌘J to create your first project
      </p>
    </div>
  );
};

const ProjectCard = ({ data }: { data: Doc<"projects"> }) => {
  return (
    <Link
      href={`/projects/${data._id}`}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition-all duration-200",
        "hover:bg-white/[0.05]",
      )}
    >
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-200",
          "border-white/[0.08] bg-white/[0.04]",
          "group-hover:border-ring/20 group-hover:bg-ring/8",
        )}
      >
        <ProjectIcon
          project={data}
          className="text-muted-foreground/60 transition-colors group-hover:text-ring/70"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground/85 transition-colors group-hover:text-foreground">
          {data.name}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">
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
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-3.5 py-2">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/40">
          Recent
        </span>
        <button
          onClick={onViewAll}
          className="font-mono text-[10px] text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          View all →
        </button>
      </div>

      <div className="flex flex-col gap-px">
        {projects.map((project) => (
          <ProjectCard key={project._id} data={project} />
        ))}
      </div>
    </section>
  );
};

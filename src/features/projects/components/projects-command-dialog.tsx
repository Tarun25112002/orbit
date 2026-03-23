"use client";

import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { FaGithub } from "react-icons/fa";
import {
  AlertCircleIcon,
  FolderOpenIcon,
  GlobeIcon,
  Loader2Icon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useProjects } from "../hooks/use-projects";
import { Doc } from "../../../../convex/_generated/dataModel";

interface ProjectsCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatUpdatedAt = (timestamp: number) =>
  formatDistanceToNow(new Date(timestamp), { addSuffix: true });

const getProjectIcon = (project: Doc<"projects">) => {
  const base = "size-3.5";

  if (project.importStatus === "completed") {
    return <FaGithub className={cn(base, "text-muted-foreground/70")} />;
  }
  if (project.importStatus === "failed") {
    return <AlertCircleIcon className={cn(base, "text-destructive/80")} />;
  }
  if (project.importStatus === "importing") {
    return <Loader2Icon className={cn(base, "animate-spin text-ring/70")} />;
  }
  return <GlobeIcon className={cn(base, "text-muted-foreground/60")} />;
};

const LoadingState = () => (
  <div className="flex items-center justify-center py-10">
    <Spinner className="size-4 text-ring/50" />
  </div>
);

const EmptyState = () => (
  <CommandEmpty>
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <FolderOpenIcon className="size-4 text-muted-foreground/50" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground/80">
          No projects found
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">
          Try a different search term
        </p>
      </div>
    </div>
  </CommandEmpty>
);

const ProjectResultItem = ({
  project,
  onSelect,
}: {
  project: Doc<"projects">;
  onSelect: (projectId: string) => void;
}) => (
  <CommandItem
    value={`${project.name}-${project._id}`}
    onSelect={() => onSelect(project._id)}
    className={cn(
      "group flex items-center gap-3 rounded-lg px-3 py-2.5",
      "data-selected:bg-white/[0.05]",
    )}
  >
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors duration-150",
        "border-white/[0.08] bg-white/[0.03]",
        "group-data-selected:border-ring/20 group-data-selected:bg-ring/8",
      )}
    >
      {getProjectIcon(project)}
    </div>

    <div className="min-w-0 flex-1">
      <span className="truncate text-sm font-medium text-foreground/85 group-data-selected:text-foreground">
        {project.name}
      </span>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/50">
        {formatUpdatedAt(project.updatedAt)}
      </div>
    </div>
  </CommandItem>
);

export const ProjectsCommandDialog = ({
  open,
  onOpenChange,
}: ProjectsCommandDialogProps) => {
  const router = useRouter();
  const projects = useProjects();

  const handleSelect = (projectId: string) => {
    onOpenChange(false);
    router.push(`/projects/${projectId}`);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Projects"
      description="Search and navigate to your projects"
      className="overflow-hidden border-white/[0.08] bg-popover/95 backdrop-blur-2xl sm:max-w-[460px]"
    >
      <div className="border-b border-white/[0.06]">
        <CommandInput placeholder="Search projects…" />
      </div>

      {projects === undefined ? (
        <LoadingState />
      ) : (
        <CommandList className="max-h-80">
          <EmptyState />
          <CommandGroup
            heading={
              <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
                Projects · {projects.length}
              </span>
            }
          >
            {projects.map((project) => (
              <ProjectResultItem
                key={project._id}
                project={project}
                onSelect={handleSelect}
              />
            ))}
          </CommandGroup>
        </CommandList>
      )}

      <div className="flex items-center gap-3 border-t border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/40">
          <Kbd className="h-4 px-1 text-[9px]">↑↓</Kbd>
          <span>navigate</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/40">
          <Kbd className="h-4 px-1 text-[9px]">↵</Kbd>
          <span>open</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/40">
          <Kbd className="h-4 px-1 text-[9px]">esc</Kbd>
          <span>close</span>
        </div>
      </div>
    </CommandDialog>
  );
};

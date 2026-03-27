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
    return <FaGithub className={`${base} text-muted-foreground/70`} />;
  }
  if (project.importStatus === "failed") {
    return <AlertCircleIcon className={`${base} text-destructive/80`} />;
  }
  if (project.importStatus === "importing") {
    return <Loader2Icon className={`${base} animate-spin text-ring/70`} />;
  }
  return <GlobeIcon className={`${base} text-muted-foreground/60`} />;
};

const LoadingState = () => (
  <div className="flex flex-col items-center gap-2 py-12">
    <Spinner className="size-5 text-ring/40" />
    <span className="font-mono text-[11px] text-muted-foreground/40">
      Loading projects…
    </span>
  </div>
);

const EmptyState = () => (
  <CommandEmpty>
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-dashed border-white/12 bg-white/2">
        <FolderOpenIcon className="size-4 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground/80">
          No matching projects
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground/40">
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
    className="group flex items-center gap-3 rounded-lg px-3 py-2.5 data-selected:bg-white/5"
  >
    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/3 transition-colors duration-150 group-data-selected:border-ring/20 group-data-selected:bg-ring/8">
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
      className="rounded-2xl! bg-[oklch(0.16_0_0)]/98 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:max-w-130"
    >
      <div className="border-b border-white/6 px-1 py-1">
        <CommandInput placeholder="Search projects…" />
      </div>

      {projects === undefined ? (
        <LoadingState />
      ) : (
        <CommandList className="max-h-90 px-1">
          <EmptyState />
          <CommandGroup
            heading={
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40">
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

      <div className="flex items-center gap-4 border-t border-white/6 px-4 py-2">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/30">
          <Kbd className="h-4.5 border border-white/6 bg-white/3 text-[9px]">
            ↑↓
          </Kbd>
          <span>navigate</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/30">
          <Kbd className="h-4.5 border border-white/6 bg-white/3 text-[9px]">
            ↵
          </Kbd>
          <span>open</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/30">
          <Kbd className="h-4.5 border border-white/6 bg-white/3 text-[9px]">
            esc
          </Kbd>
          <span>close</span>
        </div>
      </div>
    </CommandDialog>
  );
};

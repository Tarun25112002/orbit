import { useState } from "react";
import {
  ChevronRightIcon,
  CopyMinusIcon,
  FilePlusCornerIcon,
  FolderPlusIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useProject } from "../../hooks/use-projects";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  useCreateFile,
  useCreateFolder,
  useFolderContents,
} from "../../hooks/use-files";
import { CreateInput } from "./create-input";
import { LoadingRow } from "./loading";
import { Tree } from "./tree";

export const FileExplorer = ({
  projectId,
  selectedFileId,
  onSelectFile,
}: {
  projectId: Id<"projects">;
  selectedFileId?: Id<"files"> | null;
  onSelectFile?: (fileId: Id<"files"> | null) => void;
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [internalSelectedFileId, setInternalSelectedFileId] =
    useState<Id<"files"> | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<Id<"files">>>(
    () => new Set(),
  );

  const activeSelectedFileId =
    selectedFileId !== undefined ? selectedFileId : internalSelectedFileId;
  const handleSelectFile = onSelectFile ?? setInternalSelectedFileId;

  const project = useProject(projectId);
  const rootFiles = useFolderContents({
    projectId,
    enabled: isOpen,
  });

  const createFile = useCreateFile();
  const createFolder = useCreateFolder();

  const toggleFolder = (folderId: Id<"files">) => {
    setExpandedFolders((current) => {
      const next = new Set(current);

      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });
  };

  const expandFolder = (folderId: Id<"files">) => {
    setExpandedFolders((current) => {
      if (current.has(folderId)) {
        return current;
      }

      const next = new Set(current);
      next.add(folderId);
      return next;
    });
  };

  const handleCreate = async (name: string) => {
    const nextItemType = creating;
    if (!nextItemType) {
      return;
    }

    if (nextItemType === "file") {
      const fileId = await createFile({
        projectId,
        name,
        content: "",
        parentId: undefined,
      });

      setCreating(null);
      handleSelectFile(fileId);
      return;
    }

    await createFolder({
      projectId,
      name,
      parentId: undefined,
    });

    setCreating(null);
  };

  return (
    <div className="h-full bg-sidebar">
      <ScrollArea className="h-full">
        <div className="group/project flex items-center gap-0.5 bg-accent font-bold">
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            className="flex h-5.5 min-w-0 flex-1 items-center gap-0.5 text-left"
          >
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                isOpen && "rotate-90",
              )}
            />
            <p className="text-xs uppercase line-clamp-1">
              {project?.name ?? "Loading..."}
            </p>
          </button>
          <div className="opacity-0 group-hover/project:opacity-100 transition-none duration-0 flex items-center gap-0.5 ml-auto">
            <Button
              type="button"
              aria-label="Create file"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("file");
              }}
              variant="ghost"
              size="icon-xs"
            >
              <FilePlusCornerIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              aria-label="Create folder"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("folder");
              }}
              variant="ghost"
              size="icon-xs"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              aria-label="Collapse all folders"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setExpandedFolders(new Set());
              }}
              variant="ghost"
              size="icon-xs"
            >
              <CopyMinusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {isOpen && (
          <div role="tree" aria-label="Project files">
            {rootFiles === undefined && <LoadingRow level={0} />}
            {creating && (
              <CreateInput
                type={creating}
                level={0}
                onSubmit={handleCreate}
                onCancel={() => setCreating(null)}
              />
            )}
            {rootFiles?.map((item) => (
              <Tree
                key={item._id}
                item={item}
                level={0}
                projectId={projectId}
                selectedFileId={activeSelectedFileId}
                onSelectFile={handleSelectFile}
                expandedFolders={expandedFolders}
                onToggleFolder={toggleFolder}
                onExpandFolder={expandFolder}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

import { useMemo, useState } from "react";
import {
  ChevronRightIcon,
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
  useProjectFiles,
} from "../../hooks/use-files";
import { CreateInput } from "./create-input";
import { LoadingRow } from "./loading";
import { Tree } from "./tree";
import { buildTreeModel } from "./tree-model";

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
  const [creatingParentId, setCreatingParentId] = useState<
    Id<"files"> | undefined
  >(undefined);
  const [internalSelectedFileId, setInternalSelectedFileId] =
    useState<Id<"files"> | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<Id<"files"> | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<Id<"files">>>(
    () => new Set(),
  );

  const activeSelectedFileId =
    selectedFileId !== undefined ? selectedFileId : internalSelectedFileId;
  const handleSelectFile = onSelectFile ?? setInternalSelectedFileId;

  const project = useProject(projectId);
  const files = useProjectFiles({
    projectId,
    enabled: isOpen,
  });
  const treeModel = useMemo(
    () => buildTreeModel(files ?? []),
    [files],
  );
  const itemsById = useMemo(
    () => new Map((files ?? []).map((item) => [item._id, item])),
    [files],
  );
  const activeItemId =
    focusedItemId && itemsById.has(focusedItemId)
      ? focusedItemId
      : activeSelectedFileId;
  const activeItem = activeItemId ? itemsById.get(activeItemId) : undefined;

  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const resetCreateState = () => {
    setCreating(null);
    setCreatingParentId(undefined);
  };
  const isCreateTargetWithinFolder = (folderId: Id<"files">) => {
    let cursor = creatingParentId;

    while (cursor) {
      if (cursor === folderId) {
        return true;
      }

      cursor = treeModel.parentById.get(cursor);
    }

    return false;
  };

  const toggleFolder = (folderId: Id<"files">) => {
    const isClosing = expandedFolders.has(folderId);

    setExpandedFolders((current) => {
      const next = new Set(current);

      if (isClosing) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }

      return next;
    });

    if (isClosing && creating && isCreateTargetWithinFolder(folderId)) {
      resetCreateState();
    }
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
  const expandAncestorFolders = (itemId: Id<"files">) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      let didChange = false;
      let cursor = treeModel.parentById.get(itemId);

      while (cursor) {
        if (!next.has(cursor)) {
          next.add(cursor);
          didChange = true;
        }

        cursor = treeModel.parentById.get(cursor);
      }

      return didChange ? next : current;
    });
  };
  const handleFocusItem = (itemId: Id<"files"> | null) => {
    if (itemId) {
      expandAncestorFolders(itemId);
    }

    setFocusedItemId(itemId);
  };
  const handleSelectExplorerFile = (fileId: Id<"files"> | null) => {
    if (fileId) {
      expandAncestorFolders(fileId);
    }

    setFocusedItemId(fileId);
    handleSelectFile(fileId);
  };
  const resolveCreateParentId = () => {
    if (!activeItem) {
      return undefined;
    }

    if (activeItem.type === "folder") {
      return activeItem._id;
    }

    return activeItem.parentId;
  };
  const defaultCreateParentId = resolveCreateParentId();
  const createTargetId = creating ? creatingParentId : defaultCreateParentId;
  const createTargetItem = createTargetId
    ? itemsById.get(createTargetId)
    : undefined;
  const createTargetLabel = createTargetItem?.name ?? project?.name;
  const startCreate = (
    type: "file" | "folder",
    parentId = defaultCreateParentId,
  ) => {
    setIsOpen(true);
    setCreating(type);
    setCreatingParentId(parentId);

    if (parentId) {
      expandFolder(parentId);
    }
  };

  const handleCreate = async (name: string) => {
    const nextItemType = creating;
    if (!nextItemType) {
      return;
    }
    const parentId = creatingParentId;

    if (nextItemType === "file") {
      const fileId = await createFile({
        projectId,
        name,
        content: "",
        parentId,
      });

      resetCreateState();
      handleSelectExplorerFile(fileId);
      return;
    }

    const folderId = await createFolder({
      projectId,
      name,
      parentId,
    });

    if (parentId) {
      expandFolder(parentId);
    }
    expandFolder(folderId);
    setFocusedItemId(folderId);
    resetCreateState();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="border-b border-sidebar-border/70 bg-sidebar/95 px-2 py-1.5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
            Explorer
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              aria-label="Create file"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startCreate("file");
              }}
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <FilePlusCornerIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              aria-label="Create folder"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startCreate("folder");
              }}
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground/55">
          New items in {createTargetLabel ?? project?.name ?? "project root"}
        </p>
      </div>
      <div className="border-b border-sidebar-border/60 bg-sidebar-accent/45">
        <div className="flex items-center gap-0.5 font-bold">
          <button
            type="button"
            onClick={() => setIsOpen((value) => !value)}
            className="flex h-6 min-w-0 flex-1 items-center gap-0.5 px-2 text-left"
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
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {isOpen && (
          <div className="px-1 py-1.5">
            {files !== undefined &&
              treeModel.roots.length === 0 &&
              !creating && (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground/70">
                  Create your first file or folder to start building.
                </div>
              )}
            <div role="tree" aria-label="Project files" className="space-y-0.5">
              {files === undefined && <LoadingRow level={0} />}
              {creating && !creatingParentId && (
                <CreateInput
                  type={creating}
                  level={0}
                  onSubmit={handleCreate}
                  onCancel={resetCreateState}
                />
              )}
              {treeModel.roots.map((node) => (
                <Tree
                  key={node.item._id}
                  node={node}
                  level={0}
                  selectedFileId={activeSelectedFileId}
                  activeItemId={activeItemId}
                  onSelectFile={handleSelectExplorerFile}
                  onFocusItem={handleFocusItem}
                  creating={creating}
                  createTargetId={creatingParentId}
                  onStartCreate={startCreate}
                  onCreate={handleCreate}
                  onCancelCreate={resetCreateState}
                  expandedFolders={expandedFolders}
                  onToggleFolder={toggleFolder}
                  onExpandFolder={expandFolder}
                />
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

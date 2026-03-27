import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronRightIcon,
  FilePlusCornerIcon,
  FolderPlusIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  useDeleteFile,
  useRenameFile,
} from "@/features/projects/hooks/use-files";

import { CreateInput } from "./create-input";
import { RenameInput } from "./rename-input";
import { TreeItemWrapper } from "./tree-item-wrapper";
import { ItemIcon } from "./item-icon";
import { FileTreeNode } from "./tree-model";
import { Id } from "../../../../../convex/_generated/dataModel";

export const Tree = ({
  node,
  level = 0,
  selectedFileId,
  activeItemId,
  onSelectFile,
  onFocusItem,
  creating,
  createTargetId,
  onStartCreate,
  onCreate,
  onCancelCreate,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
}: {
  node: FileTreeNode;
  level?: number;
  selectedFileId: Id<"files"> | null;
  activeItemId: Id<"files"> | null;
  onSelectFile: (fileId: Id<"files"> | null) => void;
  onFocusItem: (itemId: Id<"files"> | null) => void;
  creating: "file" | "folder" | null;
  createTargetId?: Id<"files">;
  onStartCreate: (
    type: "file" | "folder",
    parentId: Id<"files">,
  ) => void;
  onCreate: (name: string) => Promise<void>;
  onCancelCreate: () => void;
  expandedFolders: ReadonlySet<Id<"files">>;
  onToggleFolder: (folderId: Id<"files">) => void;
  onExpandFolder: (folderId: Id<"files">) => void;
}) => {
  const item = node.item;
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const renameFile = useRenameFile();
  const deleteFile = useDeleteFile();
  const isOpen = item.type === "folder" && expandedFolders.has(item._id);
  const createType =
    item.type === "folder" && item._id === createTargetId ? creating : null;

  const handleRename = async (newName: string) => {
    if (newName === item.name) {
      setIsRenaming(false);
      return;
    }

    await renameFile({ id: item._id, newName });
    setIsRenaming(false);
  };

  const handleDelete = async () => {
    if (isDeleting) {
      return;
    }

    const shouldClearSelection = selectedFileId === item._id;
    if (shouldClearSelection) {
      onSelectFile(null);
    }

    setIsDeleting(true);

    try {
      await deleteFile({ id: item._id });
    } catch (error) {
      if (shouldClearSelection) {
        onSelectFile(item._id);
      }

      toast.error(getErrorMessage(error, `Unable to delete ${item.name}.`));
    } finally {
      setIsDeleting(false);
    }
  };

  const startCreating = (type: "file" | "folder") => {
    onExpandFolder(item._id);
    onFocusItem(item._id);
    onStartCreate(type, item._id);
  };

  if (item.type === "file") {
    const isActive = activeItemId === item._id;

    if (isRenaming) {
      return (
        <RenameInput
          type="file"
          defaultValue={item.name}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
      );
    }

    return (
      <TreeItemWrapper
        item={item}
        level={level}
        isActive={isActive}
        disabled={isDeleting}
        onClick={() => {
          onFocusItem(item._id);
          onSelectFile(item._id);
        }}
        onContextMenu={() => onFocusItem(item._id)}
        onDoubleClick={() => {
          onFocusItem(item._id);
          onSelectFile(item._id);
        }}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          void handleDelete();
        }}
      >
        <ItemIcon type="file" name={item.name} />
        <span className="truncate text-sm">{item.name}</span>
      </TreeItemWrapper>
    );
  }

  const folderIcon = (
    <div className="flex items-center gap-0.5">
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 text-muted-foreground",
          isOpen && "rotate-90",
        )}
      />
      <ItemIcon type="folder" name={item.name} isOpen={isOpen} />
    </div>
  );
  const isActive = activeItemId === item._id;
  const folderActions = (
    <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Button
        type="button"
        aria-label={`Create file inside ${item.name}`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          startCreating("file");
        }}
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
      >
        <FilePlusCornerIcon className="size-3.5" />
      </Button>
      <Button
        type="button"
        aria-label={`Create folder inside ${item.name}`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          startCreating("folder");
        }}
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
      >
        <FolderPlusIcon className="size-3.5" />
      </Button>
    </div>
  );

  const folderChildren = isOpen ? (
    <div role="group">
      {createType && (
        <CreateInput
          type={createType}
          level={level + 1}
          onSubmit={onCreate}
          onCancel={onCancelCreate}
        />
      )}
      {node.children.map((childNode) => (
        <Tree
          key={childNode.item._id}
          node={childNode}
          level={level + 1}
          selectedFileId={selectedFileId}
          activeItemId={activeItemId}
          onSelectFile={onSelectFile}
          onFocusItem={onFocusItem}
          creating={creating}
          createTargetId={createTargetId}
          onStartCreate={onStartCreate}
          onCreate={onCreate}
          onCancelCreate={onCancelCreate}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          onExpandFolder={onExpandFolder}
        />
      ))}
    </div>
  ) : null;

  if (isRenaming) {
    return (
      <>
        <RenameInput
          type="folder"
          defaultValue={item.name}
          isOpen={isOpen}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
        {folderChildren}
      </>
    );
  }

  return (
    <>
      <TreeItemWrapper
        item={item}
        level={level}
        isActive={isActive}
        isExpanded={isOpen}
        disabled={isDeleting}
        onClick={() => {
          onFocusItem(item._id);
          onToggleFolder(item._id);
        }}
        onContextMenu={() => onFocusItem(item._id)}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          void handleDelete();
        }}
        onCreateFile={() => startCreating("file")}
        onCreateFolder={() => startCreating("folder")}
        actions={folderActions}
      >
        {folderIcon}
        <span className="truncate text-sm">{item.name}</span>
      </TreeItemWrapper>
      {folderChildren}
    </>
  );
};

import { useState } from "react";
import { toast } from "sonner";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import {
  useCreateFile,
  useCreateFolder,
  useDeleteFile,
  useFolderContents,
  useRenameFile,
} from "@/features/projects/hooks/use-files";

import { LoadingRow } from "./loading";
import { CreateInput } from "./create-input";
import { RenameInput } from "./rename-input";
import { TreeItemWrapper } from "./tree-item-wrapper";
import { ItemIcon } from "./item-icon";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

export const Tree = ({
  item,
  level = 0,
  projectId,
  selectedFileId,
  onSelectFile,
  expandedFolders,
  onToggleFolder,
  onExpandFolder,
}: {
  item: Doc<"files">;
  level?: number;
  projectId: Id<"projects">;
  selectedFileId: Id<"files"> | null;
  onSelectFile: (fileId: Id<"files"> | null) => void;
  expandedFolders: ReadonlySet<Id<"files">>;
  onToggleFolder: (folderId: Id<"files">) => void;
  onExpandFolder: (folderId: Id<"files">) => void;
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  const renameFile = useRenameFile();
  const deleteFile = useDeleteFile();
  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const isOpen = item.type === "folder" && expandedFolders.has(item._id);

  const folderContents = useFolderContents({
    projectId,
    parentId: item._id,
    enabled: item.type === "folder" && isOpen,
  });

  const handleRename = async (newName: string) => {
    if (newName === item.name) {
      setIsRenaming(false);
      return;
    }

    await renameFile({ id: item._id, newName });
    setIsRenaming(false);
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
        parentId: item._id,
      });

      setCreating(null);
      onSelectFile(fileId);
      return;
    }

    await createFolder({
      projectId,
      name,
      parentId: item._id,
    });

    setCreating(null);
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
    setCreating(type);
  };

  if (item.type === "file") {
    const isActive = selectedFileId === item._id;

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
        onClick={() => onSelectFile(item._id)}
        onDoubleClick={() => onSelectFile(item._id)}
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
      <ItemIcon type="folder" isOpen={isOpen} />
    </div>
  );

  const folderChildren = isOpen ? (
    <div role="group">
      {folderContents === undefined && <LoadingRow level={level + 1} />}
      {creating && (
        <CreateInput
          type={creating}
          level={level + 1}
          onSubmit={handleCreate}
          onCancel={() => setCreating(null)}
        />
      )}
      {folderContents?.map((subItem) => (
        <Tree
          key={subItem._id}
          item={subItem}
          level={level + 1}
          projectId={projectId}
          selectedFileId={selectedFileId}
          onSelectFile={onSelectFile}
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
        isExpanded={isOpen}
        disabled={isDeleting}
        onClick={() => onToggleFolder(item._id)}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          void handleDelete();
        }}
        onCreateFile={() => startCreating("file")}
        onCreateFolder={() => startCreating("folder")}
      >
        {folderIcon}
        <span className="truncate text-sm">{item.name}</span>
      </TreeItemWrapper>
      {folderChildren}
    </>
  );
};

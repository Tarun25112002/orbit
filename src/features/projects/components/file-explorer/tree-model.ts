import { Doc, Id } from "../../../../../convex/_generated/dataModel";

export type FileTreeNode = {
  item: Doc<"files">;
  children: FileTreeNode[];
};

type ParentMap = Map<Id<"files">, Id<"files"> | undefined>;

const compareFiles = (a: Doc<"files">, b: Doc<"files">) => {
  if (a.type === "folder" && b.type === "file") return -1;
  if (a.type === "file" && b.type === "folder") return 1;

  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

const sortFiles = (files: Doc<"files">[]) => [...files].sort(compareFiles);

export const buildTreeModel = (
  files: Doc<"files">[],
): {
  roots: FileTreeNode[];
  parentById: ParentMap;
} => {
  const fileIds = new Set<Id<"files">>();
  for (const file of files) {
    fileIds.add(file._id);
  }

  const childrenByParent = new Map<Id<"files"> | undefined, Doc<"files">[]>();
  const parentById: ParentMap = new Map();

  for (const file of files) {
    const parentId =
      file.parentId && fileIds.has(file.parentId) ? file.parentId : undefined;

    parentById.set(file._id, parentId);

    const siblings = childrenByParent.get(parentId);
    if (siblings) {
      siblings.push(file);
    } else {
      childrenByParent.set(parentId, [file]);
    }
  }

  for (const [parentId, siblings] of childrenByParent.entries()) {
    childrenByParent.set(parentId, sortFiles(siblings));
  }

  const visited = new Set<Id<"files">>();

  const buildNodes = (parentId?: Id<"files">): FileTreeNode[] => {
    const children = childrenByParent.get(parentId) ?? [];

    return children.flatMap((child) => {
      if (visited.has(child._id)) {
        return [];
      }

      visited.add(child._id);
      return [
        {
          item: child,
          children: child.type === "folder" ? buildNodes(child._id) : [],
        },
      ];
    });
  };

  const roots = buildNodes(undefined);
  const looseItems = sortFiles(files.filter((file) => !visited.has(file._id)));

  for (const looseItem of looseItems) {
    roots.push({
      item: looseItem,
      children:
        looseItem.type === "folder" ? buildNodes(looseItem._id) : [],
    });
  }

  return {
    roots,
    parentById,
  };
};

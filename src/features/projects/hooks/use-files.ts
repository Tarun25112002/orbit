import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import { patchProjectCaches } from "./use-projects";

type UseFolderContentsArgs = {
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  enabled?: boolean;
};

export const useFolderContents = ({
  projectId,
  parentId,
  enabled = true,
}: UseFolderContentsArgs) =>
  useQuery(
    api.files.getFolderContents,
    enabled ? { projectId, parentId } : "skip",
  );

export const useProjectFiles = ({
  projectId,
  enabled = true,
}: {
  projectId: Id<"projects">;
  enabled?: boolean;
}) => useQuery(api.files.getFiles, enabled ? { projectId } : "skip");

const sortFolderContents = (items: Doc<"files">[]) =>
  [...items].sort((a, b) => {
    if (a.type === "folder" && b.type === "file") return -1;
    if (a.type === "file" && b.type === "folder") return 1;

    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

const updateFolderContents = (
  localStore: OptimisticLocalStore,
  {
    projectId,
    parentId,
  }: {
    projectId: Id<"projects">;
    parentId?: Id<"files">;
  },
  updater: (current: Doc<"files">[]) => Doc<"files">[],
) => {
  const existing = localStore.getQuery(api.files.getFolderContents, {
    projectId,
    parentId,
  });
  if (existing === undefined) {
    return;
  }

  localStore.setQuery(
    api.files.getFolderContents,
    {
      projectId,
      parentId,
    },
    sortFolderContents(updater(existing)),
  );
};

const updateProjectFiles = (
  localStore: OptimisticLocalStore,
  projectId: Id<"projects">,
  updater: (current: Doc<"files">[]) => Doc<"files">[],
) => {
  const existing = localStore.getQuery(api.files.getFiles, { projectId });
  if (existing === undefined) {
    return;
  }

  localStore.setQuery(
    api.files.getFiles,
    { projectId },
    sortFolderContents(updater(existing)),
  );
};

const collectDescendantIds = (
  files: Doc<"files">[],
  rootId: Id<"files">,
) => {
  const idsToDelete = new Set<Id<"files">>([rootId]);
  let didExpand = true;

  while (didExpand) {
    didExpand = false;

    for (const file of files) {
      if (file.parentId && idsToDelete.has(file.parentId) && !idsToDelete.has(file._id)) {
        idsToDelete.add(file._id);
        didExpand = true;
      }
    }
  }

  return idsToDelete;
};

export const useCreateFile = () =>
  useMutation(api.files.createFile).withOptimisticUpdate((localStore, args) => {
    const name = args.name.trim();
    if (!name) {
      return;
    }
    patchProjectCaches(localStore, {
      projectId: args.projectId,
    });
  });

export const useCreateFolder = () =>
  useMutation(api.files.createFolder).withOptimisticUpdate(
    (localStore, args) => {
      const name = args.name.trim();
      if (!name) {
        return;
      }
      patchProjectCaches(localStore, {
        projectId: args.projectId,
      });
    },
  );

export const useRenameFile = () =>
  useMutation(api.files.renameFile).withOptimisticUpdate((localStore, args) => {
    const existing = localStore.getQuery(api.files.getFile, { id: args.id });
    const newName = args.newName.trim();

    if (!existing || !newName) {
      return;
    }

    const updatedItem = {
      ...existing,
      name: newName,
      updatedAt: existing.updatedAt + 1,
    };

    localStore.setQuery(api.files.getFile, { id: args.id }, updatedItem);
    updateFolderContents(
      localStore,
      {
        projectId: existing.projectId,
        parentId: existing.parentId,
      },
      (current) =>
        current.map((item) => (item._id === args.id ? updatedItem : item)),
    );
    updateProjectFiles(localStore, existing.projectId, (current) =>
      current.map((item) => (item._id === args.id ? updatedItem : item)),
    );
    patchProjectCaches(localStore, {
      projectId: existing.projectId,
    });
  });

export const useDeleteFile = () =>
  useMutation(api.files.deleteFile).withOptimisticUpdate((localStore, args) => {
    const existing = localStore.getQuery(api.files.getFile, { id: args.id });
    if (!existing) {
      return;
    }

    const projectFiles = localStore.getQuery(api.files.getFiles, {
      projectId: existing.projectId,
    });
    const idsToDelete = projectFiles
      ? collectDescendantIds(projectFiles, args.id)
      : new Set<Id<"files">>([args.id]);

    for (const id of idsToDelete) {
      localStore.setQuery(api.files.getFile, { id }, null);
    }

    updateFolderContents(
      localStore,
      {
        projectId: existing.projectId,
        parentId: existing.parentId,
      },
      (current) => current.filter((item) => item._id !== args.id),
    );
    updateProjectFiles(localStore, existing.projectId, (current) =>
      current.filter((item) => !idsToDelete.has(item._id)),
    );
    patchProjectCaches(localStore, {
      projectId: existing.projectId,
    });
  });

export const useFile = ({
  id,
  enabled = true,
}: {
  id: Id<"files"> | null;
  enabled?: boolean;
}) => useQuery(api.files.getFile, enabled && id ? { id } : "skip");

export const useUpdateFile = () =>
  useMutation(api.files.updateFile).withOptimisticUpdate((localStore, args) => {
    const existing = localStore.getQuery(api.files.getFile, { id: args.id });
    if (!existing || existing.type !== "file") {
      return;
    }

    const updatedFile = {
      ...existing,
      content: args.content,
      updatedAt: existing.updatedAt + 1,
    };

    localStore.setQuery(api.files.getFile, { id: args.id }, updatedFile);
    updateProjectFiles(localStore, existing.projectId, (current) =>
      current.map((item) => (item._id === args.id ? updatedFile : item)),
    );
    patchProjectCaches(localStore, {
      projectId: existing.projectId,
    });
  });

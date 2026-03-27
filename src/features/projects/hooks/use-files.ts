import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

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

const sortFolderContents = (items: Doc<"files">[]) =>
  [...items].sort((a, b) => {
    if (a.type === "folder" && b.type === "file") return -1;
    if (a.type === "file" && b.type === "folder") return 1;

    return a.name.localeCompare(b.name);
  });

const getNextOptimisticTimestamp = (items: Doc<"files">[]) =>
  items.reduce(
    (maxTimestamp, item) =>
      Math.max(maxTimestamp, item.updatedAt, item._creationTime),
    0,
  ) + 1;

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

export const useCreateFile = () =>
  useMutation(api.files.createFile).withOptimisticUpdate((localStore, args) => {
    const name = args.name.trim();
    if (!name) {
      return;
    }

    updateFolderContents(
      localStore,
      {
        projectId: args.projectId,
        parentId: args.parentId,
      },
      (current) => {
        const timestamp = getNextOptimisticTimestamp(current);

        return [
          ...current,
          {
            _id: crypto.randomUUID() as Id<"files">,
            _creationTime: timestamp,
            projectId: args.projectId,
            parentId: args.parentId,
            name,
            type: "file",
            content: args.content,
            updatedAt: timestamp,
          },
        ];
      },
    );
  });

export const useCreateFolder = () =>
  useMutation(api.files.createFolder).withOptimisticUpdate(
    (localStore, args) => {
      const name = args.name.trim();
      if (!name) {
        return;
      }

      updateFolderContents(
        localStore,
        {
          projectId: args.projectId,
          parentId: args.parentId,
        },
        (current) => {
          const timestamp = getNextOptimisticTimestamp(current);

          return [
            ...current,
            {
              _id: crypto.randomUUID() as Id<"files">,
              _creationTime: timestamp,
              projectId: args.projectId,
              parentId: args.parentId,
              name,
              type: "folder",
              updatedAt: timestamp,
            },
          ];
        },
      );
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
  });

export const useDeleteFile = () =>
  useMutation(api.files.deleteFile).withOptimisticUpdate((localStore, args) => {
    const existing = localStore.getQuery(api.files.getFile, { id: args.id });
    if (!existing) {
      return;
    }

    localStore.setQuery(api.files.getFile, { id: args.id }, null);
    updateFolderContents(
      localStore,
      {
        projectId: existing.projectId,
        parentId: existing.parentId,
      },
      (current) => current.filter((item) => item._id !== args.id),
    );
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

    localStore.setQuery(api.files.getFile, { id: args.id }, {
      ...existing,
      content: args.content,
      updatedAt: existing.updatedAt + 1,
    });
  });

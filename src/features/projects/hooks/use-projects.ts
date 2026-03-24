import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

const RECENT_PROJECTS_LIMIT = 6;

type OptimisticProject = {
  _id: Id<"projects">;
  _creationTime: number;
  name: string;
  ownerId: string;
  updatedAt: number;
  importStatus?: "importing" | "completed" | "failed";
  exportStatus?: "exporting" | "completed" | "failed" | "cancelled";
  exportRepoUrl?: string;
};

const buildOptimisticProject = (name: string): OptimisticProject => {
  const now = Date.now();
  return {
    _id: crypto.randomUUID() as Id<"projects">,
    _creationTime: now,
    name,
    ownerId: "anonymous",
    updatedAt: now,
  };
};

const sortByUpdatedAt = <T extends { updatedAt: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt);

const reorderAfterTouch = (
  list: (Doc<"projects"> | OptimisticProject)[],
  projectId: Id<"projects">,
  updatedAt: number,
) => {
  const touched = list.find((p) => p._id === projectId);
  if (!touched) return list;
  const rest = list.filter((p) => p._id !== projectId);
  return sortByUpdatedAt([{ ...touched, updatedAt }, ...rest]);
};

export const useProjects = () => useQuery(api.projects.get);

export const useProjectsPartial = (limit: number) =>
  useQuery(api.projects.getPartial, { limit });

export const useProject = (projectId: Id<"projects">) =>
  useQuery(api.projects.getById, { id: projectId });

export const useCreateProject = () =>
  useMutation(api.projects.create).withOptimisticUpdate((localStore, args) => {
    const optimistic = buildOptimisticProject(args.name);

    const all = localStore.getQuery(api.projects.get) ?? [];
    localStore.setQuery(api.projects.get, {}, [optimistic, ...all]);

    const recent =
      localStore.getQuery(api.projects.getPartial, {
        limit: RECENT_PROJECTS_LIMIT,
      }) ?? [];
    localStore.setQuery(
      api.projects.getPartial,
      { limit: RECENT_PROJECTS_LIMIT },
      [optimistic, ...recent].slice(0, RECENT_PROJECTS_LIMIT),
    );
  });

export const useRenameProject = (projectId: Id<"projects">) =>
  useMutation(api.projects.rename).withOptimisticUpdate((localStore, args) => {
    const existing0 = localStore.getQuery(api.projects.getById, {
      id: projectId,
    });
    const now = existing0?.updatedAt ?? 0;

    const existing = localStore.getQuery(api.projects.getById, {
      id: projectId,
    });
    if (existing) {
      localStore.setQuery(
        api.projects.getById,
        { id: projectId },
        { ...existing, name: args.name, updatedAt: now },
      );
    }

    const all = localStore.getQuery(api.projects.get) ?? [];
    localStore.setQuery(
      api.projects.get,
      {},
      all.map((p) =>
        p._id === args.id ? { ...p, name: args.name, updatedAt: now } : p,
      ),
    );

    const recent =
      localStore.getQuery(api.projects.getPartial, {
        limit: RECENT_PROJECTS_LIMIT,
      }) ?? [];
    localStore.setQuery(
      api.projects.getPartial,
      { limit: RECENT_PROJECTS_LIMIT },
      recent.map((p) =>
        p._id === args.id ? { ...p, name: args.name, updatedAt: now } : p,
      ),
    );
  });

export const useTouchProject = () =>
  useMutation(api.projects.touch).withOptimisticUpdate((localStore, args) => {
    const existing0 = localStore.getQuery(api.projects.getById, {
      id: args.projectId,
    });
    const now = existing0?.updatedAt ?? 0;

    const all = localStore.getQuery(api.projects.get) ?? [];
    localStore.setQuery(
      api.projects.get,
      {},
      reorderAfterTouch(all, args.projectId, now),
    );

    const recent =
      localStore.getQuery(api.projects.getPartial, {
        limit: RECENT_PROJECTS_LIMIT,
      }) ?? [];
    localStore.setQuery(
      api.projects.getPartial,
      { limit: RECENT_PROJECTS_LIMIT },
      reorderAfterTouch(recent, args.projectId, now).slice(
        0,
        RECENT_PROJECTS_LIMIT,
      ),
    );
  });

export const useStartGithubImport = () =>
  useMutation(api.projects.startGithubImport).withOptimisticUpdate(
    (localStore, args) => {
      const existing = localStore.getQuery(api.projects.getById, {
        id: args.projectId,
      });
      if (existing) {
        localStore.setQuery(
          api.projects.getById,
          { id: args.projectId },
          { ...existing, importStatus: "importing" as const },
        );
      }
    },
  );

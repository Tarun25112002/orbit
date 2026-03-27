import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";

const RECENT_PROJECTS_LIMIT = 6;
const PROJECT_PARTIAL_LIMITS = [3, RECENT_PROJECTS_LIMIT] as const;

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

const patchProjectList = (
  list: (Doc<"projects"> | OptimisticProject)[],
  projectId: Id<"projects">,
  patch: Partial<Pick<Doc<"projects">, "name" | "updatedAt">>,
) => {
  const hasProject = list.some((project) => project._id === projectId);
  if (!hasProject) {
    return list;
  }

  return sortByUpdatedAt(
    list.map((project) =>
      project._id === projectId ? { ...project, ...patch } : project,
    ),
  );
};

const getNextProjectUpdatedAt = (
  localStore: OptimisticLocalStore,
  projectId: Id<"projects">,
) => {
  const timestamps: number[] = [];

  const project = localStore.getQuery(api.projects.getById, { id: projectId });
  if (project) {
    timestamps.push(project.updatedAt);
  }

  const allProjects = localStore.getQuery(api.projects.get, {});
  if (allProjects) {
    timestamps.push(...allProjects.map((item) => item.updatedAt));
  }

  for (const limit of PROJECT_PARTIAL_LIMITS) {
    const partialProjects = localStore.getQuery(api.projects.getPartial, {
      limit,
    });
    if (partialProjects) {
      timestamps.push(...partialProjects.map((item) => item.updatedAt));
    }
  }

  return Math.max(0, ...timestamps) + 1;
};

export const patchProjectCaches = (
  localStore: OptimisticLocalStore,
  {
    projectId,
    name,
    updatedAt = getNextProjectUpdatedAt(localStore, projectId),
  }: {
    projectId: Id<"projects">;
    name?: string;
    updatedAt?: number;
  },
) => {
  const patch = {
    ...(name !== undefined ? { name } : {}),
    updatedAt,
  };

  const existing = localStore.getQuery(api.projects.getById, {
    id: projectId,
  });
  if (existing) {
    localStore.setQuery(api.projects.getById, { id: projectId }, {
      ...existing,
      ...patch,
    });
  }

  const allProjects = localStore.getQuery(api.projects.get, {});
  if (allProjects) {
    localStore.setQuery(
      api.projects.get,
      {},
      patchProjectList(allProjects, projectId, patch),
    );
  }

  for (const limit of PROJECT_PARTIAL_LIMITS) {
    const partialProjects = localStore.getQuery(api.projects.getPartial, {
      limit,
    });
    if (!partialProjects) {
      continue;
    }

    localStore.setQuery(
      api.projects.getPartial,
      { limit },
      patchProjectList(partialProjects, projectId, patch).slice(0, limit),
    );
  }

  return updatedAt;
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
    patchProjectCaches(localStore, {
      projectId,
      name: args.name,
    });
  });

export const useTouchProject = () =>
  useMutation(api.projects.touch).withOptimisticUpdate((localStore, args) => {
    patchProjectCaches(localStore, {
      projectId: args.projectId,
    });
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

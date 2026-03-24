import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

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


export const useProjects = () => {
  return useQuery(api.projects.get);
};

export const useProjectsPartial = (limit: number) => {
  return useQuery(api.projects.getPartial, {
    limit,
  });
};

export const useCreateProject = () => {
  return useMutation(api.projects.create).withOptimisticUpdate(
    (localStore, args) => {
      const optimisticProject = buildOptimisticProject(args.name);

      const existingProjects = localStore.getQuery(api.projects.get);

      if (existingProjects !== undefined) {
        localStore.setQuery(api.projects.get, {}, [
          optimisticProject,
          ...existingProjects,
        ]);
      }

      const existingRecentProjects = localStore.getQuery(
        api.projects.getPartial,
        {
          limit: RECENT_PROJECTS_LIMIT,
        },
      );

      if (existingRecentProjects !== undefined) {
        localStore.setQuery(
          api.projects.getPartial,
          { limit: RECENT_PROJECTS_LIMIT },
          [optimisticProject, ...existingRecentProjects].slice(
            0,
            RECENT_PROJECTS_LIMIT,
          ),
        );
      }
    },
  );
};

export const useProject = (projectId: Id<"projects">)=>{
  return useQuery(api.projects.getById, {id:projectId})
}
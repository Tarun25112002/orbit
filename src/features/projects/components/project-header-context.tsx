"use client";

import { createContext, useContext } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { AutoSaveStatus } from "./auto-save-badge";

export interface ProjectHeaderBadgeState {
  status: AutoSaveStatus;
  title: string;
}

interface ProjectHeaderContextValue {
  badge: ProjectHeaderBadgeState | null;
  setBadge: (badge: ProjectHeaderBadgeState | null) => void;
  /** Active AI chat thread (when user is inside a conversation). Drives editor live panel. */
  liveAiConversationId: Id<"conversations"> | null;
  setLiveAiConversationId: (id: Id<"conversations"> | null) => void;
}

export const ProjectHeaderContext =
  createContext<ProjectHeaderContextValue | null>(null);

export const useProjectHeaderContext = () => {
  const context = useContext(ProjectHeaderContext);
  if (!context) {
    throw new Error(
      "useProjectHeaderContext must be used within ProjectHeaderContext.Provider",
    );
  }

  return context;
};

"use client";

import { useState } from "react";
import Link from "next/link";
import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Id } from "../../../../convex/_generated/dataModel";
import { Navbar } from "./navbar";
import {
  ProjectHeaderContext,
  type ProjectHeaderBadgeState,
} from "./project-header-context";
import { ConversationSidebar } from "../../conversations/components/conversation-sidebar";
import { GitHubErrorHandler } from "./github-error-handler";
import { useProject } from "../hooks/use-projects";
import { Spinner } from "@/components/ui/spinner";

const DEFAULT_SIDEBAR_WIDTH = 400;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_MAIN_SIZE = 1000;

export const ProjectIdLayout = ({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: Id<"projects">;
}) => {
  const [badge, setBadge] = useState<ProjectHeaderBadgeState | null>(null);
  const project = useProject(projectId);

  if (project === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
        <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Loading project...
        </div>
      </main>
    );
  }

  if (project === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-foreground">
            Project Not Found
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This project may have been deleted, or you may no longer have access
            to it.
          </p>

          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground  hover:opacity-90"
            >
              Back To Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ProjectHeaderContext.Provider value={{ badge, setBadge }}>
      <GitHubErrorHandler />
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <Navbar projectId={projectId} />

        <div className="relative z-10 flex-1 overflow-hidden">
          <Allotment>
            <Allotment.Pane
              snap
              minSize={0}
              maxSize={MAX_SIDEBAR_WIDTH}
              preferredSize={DEFAULT_SIDEBAR_WIDTH}
            >
              <ConversationSidebar projectId={projectId} />
            </Allotment.Pane>

            <Allotment.Pane minSize={400} preferredSize={DEFAULT_MAIN_SIZE}>
              {children}
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
    </ProjectHeaderContext.Provider>
  );
};

"use client";

import { useState } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Id } from "../../../../convex/_generated/dataModel";
import { Navbar } from "./navbar";
import {
  ProjectHeaderContext,
  type ProjectHeaderBadgeState,
} from "./project-header-context";
import { ConversationSidebar } from "../../conversations/components/conversation-sidebar";

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

  return (
    <ProjectHeaderContext.Provider value={{ badge, setBadge }}>
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

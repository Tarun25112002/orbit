"use client";

import { Allotment } from "allotment";
import "allotment/dist/style.css";

import { Id } from "../../../../convex/_generated/dataModel";
import { Navbar } from "./navbar";

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
  return (
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
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Conversation
            </div>
          </Allotment.Pane>

          <Allotment.Pane minSize={400} preferredSize={DEFAULT_MAIN_SIZE}>
            {children}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
};

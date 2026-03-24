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

      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <span className="select-none text-[clamp(4.5rem,15vw,10rem)] font-semibold leading-none tracking-[0.14em] text-white/3">
          Orbit
        </span>
      </div>

      <div className="relative z-10 flex-1 overflow-hidden">
        <Allotment snap>
          <Allotment.Pane
            minSize={0}
            maxSize={MAX_SIDEBAR_WIDTH}
            preferredSize={DEFAULT_SIDEBAR_WIDTH}
          >
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Conversation
            </div>
          </Allotment.Pane>

          <Allotment.Pane preferredSize={DEFAULT_MAIN_SIZE}>
            {children}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
};

"use client";

import { Id } from "../../../../convex/_generated/dataModel";
import { Navbar } from "./navbar";

export const ProjectIdLayout = ({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId: Id<"projects">;
}) => {
  return (
    <div className="relative min-h-screen bg-background">
      <Navbar projectId={projectId} />
      <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
        <span className="select-none text-[clamp(4.5rem,15vw,10rem)] font-semibold leading-none tracking-[0.14em] text-white/3">
          Orbit
        </span>
      </div>
      <div className="relative z-10">{children}</div>
    </div>
  );
};

"use client";

import { useState } from "react";
import { FaGithub } from "react-icons/fa";
import { Id } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type Tab = "code" | "preview";

const TabButton = ({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150",
        isActive
          ? "bg-white/8 text-foreground"
          : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/4",
      )}
    >
      {label}
    </button>
  );
};

export const ProjectIdView = ({
  projectId: _projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const [activeTab, setActiveTab] = useState<Tab>("code");

  return (
    <div className="flex h-full flex-col">
      <nav className="flex items-center justify-between border-b border-white/6 px-3 py-1.5">
        <div className="flex items-center gap-1">
          <TabButton
            label="Code"
            isActive={activeTab === "code"}
            onClick={() => setActiveTab("code")}
          />
          <TabButton
            label="Preview"
            isActive={activeTab === "preview"}
            onClick={() => setActiveTab("preview")}
          />
        </div>

        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150",
            "border-white/10 bg-white/4 text-muted-foreground hover:border-white/20 hover:bg-white/8 hover:text-foreground",
          )}
        >
          <FaGithub className="size-3.5" />
          Export
        </button>
      </nav>

      <div className="flex-1 overflow-hidden">
        <div className="size-full" />
      </div>
    </div>
  );
};

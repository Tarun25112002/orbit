"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { Allotment } from "allotment";
import { SaveIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { Id } from "../../../../convex/_generated/dataModel";
import { useFile, useUpdateFile } from "../hooks/use-files";
import { FileExplorer } from "./file-explorer";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;

const EmptyState = ({ label }: { label: string }) => {
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
      {label}
    </div>
  );
};

const Tab = ({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 h-full px-3 cursor-pointer text-muted-foreground border-r hover:bg-accent/30",
        isActive && "bg-background text-foreground",
      )}
    >
      <span className="text-sm">{label}</span>
    </div>
  );
};

export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");
  const [selectedFileId, setSelectedFileId] = useState<Id<"files"> | null>(
    null,
  );
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const selectedFile = useFile({
    id: selectedFileId,
  });
  const updateFile = useUpdateFile();

  // Clear stale selection when a file is deleted
  useEffect(() => {
    if (selectedFileId && selectedFile === null) {
      setSelectedFileId(null);
    }
  }, [selectedFileId, selectedFile]);

  useEffect(() => {
    if (selectedFile?.type === "file") {
      setDraftContent(selectedFile.content ?? "");
    } else {
      setDraftContent("");
    }
  }, [selectedFile?._id, selectedFile?.content, selectedFile?.type]);

  const isDirty = useMemo(() => {
    if (!selectedFile || selectedFile.type !== "file") {
      return false;
    }
    return draftContent !== (selectedFile.content ?? "");
  }, [selectedFile, draftContent]);

  const handleSave = async () => {
    if (!selectedFile || selectedFile.type !== "file" || !isDirty) {
      return;
    }

    setIsSaving(true);
    try {
      await updateFile({
        id: selectedFile._id,
        content: draftContent,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void handleSave();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <nav className="h-8.75 flex items-center bg-sidebar border-b">
        <Tab
          label="Code"
          isActive={activeView === "editor"}
          onClick={() => setActiveView("editor")}
        />
        <Tab
          label="Preview"
          isActive={activeView === "preview"}
          onClick={() => setActiveView("preview")}
        />
        <div className="flex-1 flex justify-end h-full">
          <div className="h-full flex items-center gap-2 px-2">
            {selectedFile?.type === "file" && (
              <Badge variant={isDirty ? "secondary" : "outline"}>
                {isDirty ? "Unsaved changes" : "Saved"}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void handleSave();
              }}
              disabled={!isDirty || isSaving || !selectedFileId}
            >
              {isSaving ? (
                <Spinner className="size-3.5" />
              ) : (
                <SaveIcon className="size-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </nav>
      <div className="flex-1 relative">
        <div
          className={cn(
            "absolute inset-0",
            activeView === "editor" ? "visible" : "invisible",
          )}
        >
          <Allotment defaultSizes={[DEFAULT_SIDEBAR_WIDTH, DEFAULT_MAIN_SIZE]}>
            <Allotment.Pane
              snap
              minSize={MIN_SIDEBAR_WIDTH}
              maxSize={MAX_SIDEBAR_WIDTH}
              preferredSize={DEFAULT_SIDEBAR_WIDTH}
            >
              <FileExplorer
                projectId={projectId}
                selectedFileId={selectedFileId}
                onSelectFile={setSelectedFileId}
              />
            </Allotment.Pane>
            <Allotment.Pane>
              {!selectedFileId && (
                <EmptyState label="Select a file from the explorer to start editing." />
              )}
              {selectedFileId && selectedFile === undefined && (
                <div className="h-full w-full flex items-center justify-center">
                  <Spinner className="size-5" />
                </div>
              )}
              {selectedFile?.type === "folder" && (
                <EmptyState label="Folders cannot be edited. Select a file instead." />
              )}
              {selectedFile?.type === "file" && (
                <div className="h-full p-3">
                  <Textarea
                    className="h-full min-h-full font-mono text-sm"
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    spellCheck={false}
                  />
                </div>
              )}
            </Allotment.Pane>
          </Allotment>
        </div>
        <div
          className={cn(
            "absolute inset-0",
            activeView === "preview" ? "visible" : "invisible",
          )}
        >
          {!selectedFileId && (
            <EmptyState label="Select a file to preview its current content." />
          )}
          {selectedFileId && selectedFile === undefined && (
            <div className="h-full w-full flex items-center justify-center">
              <Spinner className="size-5" />
            </div>
          )}
          {selectedFile?.type === "folder" && (
            <EmptyState label="Folders have no preview. Select a file instead." />
          )}
          {selectedFile?.type === "file" && (
            <div className="h-full overflow-auto p-3">
              <pre className="min-h-full rounded-lg border bg-muted/20 p-3 font-mono text-sm whitespace-pre-wrap break-words">
                {draftContent || "(empty file)"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

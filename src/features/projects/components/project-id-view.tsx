"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { Allotment } from "allotment";
import { useConvex } from "convex/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useEditor } from "../../editor/hooks/use-editor";
import { useFile, useProjectFiles, useUpdateFile } from "../hooks/use-files";
import { FileExplorer } from "./file-explorer";
import { ItemIcon } from "./file-explorer/item-icon";
import { CodeEditor } from "../../editor/components/code-editor";

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
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-full items-center border-r px-3 text-muted-foreground hover:bg-accent/30",
        isActive && "bg-background text-foreground",
      )}
    >
      <span className="text-sm">{label}</span>
    </button>
  );
};

const SCROLL_AMOUNT = 200;

const EditorTabStrip = ({
  tabs,
  activeTabId,
  previewTabId,
  onActivate,
  onPin,
  onClose,
}: {
  tabs: Array<{ id: Id<"files">; label: string }>;
  activeTabId: Id<"files"> | null;
  previewTabId: Id<"files"> | null;
  onActivate: (fileId: Id<"files">) => void;
  onPin: (fileId: Id<"files">) => void;
  onClose: (fileId: Id<"files">) => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener("scroll", updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, tabs.length]);

  // Auto-scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const activeEl = scrollRef.current.querySelector(
      `[data-tab-id="${activeTabId}"]`,
    );
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeTabId]);

  const scroll = useCallback((direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: "smooth",
    });
  }, []);

  if (tabs.length === 0) {
    return (
      <div className="flex h-9 items-center border-b bg-sidebar/60 px-3 text-xs text-muted-foreground">
        No file open
      </div>
    );
  }

  return (
    <div className="relative flex h-9 items-end border-b bg-sidebar/60">
      {/* Left scroll button */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-0 z-10 flex h-full w-6 items-center justify-center bg-gradient-to-r from-sidebar/90 to-transparent text-muted-foreground hover:text-foreground"
          aria-label="Scroll tabs left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
      )}

      {/* Scrollable tab container */}
      <div
        ref={scrollRef}
        className="flex h-full w-full items-end gap-1 overflow-x-auto px-1.5 pt-1 scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const isPreview = previewTabId === tab.id;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={cn(
                "group flex h-8 w-40 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2",
                isActive
                  ? "bg-background text-foreground border-border"
                  : "bg-muted/35 text-muted-foreground border-transparent hover:bg-muted/50",
              )}
            >
              {/* File-type icon */}
              <span className="shrink-0">
                <ItemIcon type="file" name={tab.label} />
              </span>
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                onDoubleClick={() => onPin(tab.id)}
                className="min-w-0 flex-1 truncate text-left text-xs"
                title={tab.label}
              >
                <span className={cn(isPreview && "italic")}>{tab.label}</span>
              </button>
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                className="shrink-0 rounded p-0.5 opacity-0 transition group-hover:opacity-70 hover:!opacity-100 hover:bg-accent"
                aria-label={`Close ${tab.label}`}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Right scroll button */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          className="absolute right-0 z-10 flex h-full w-6 items-center justify-center bg-gradient-to-l from-sidebar/90 to-transparent text-muted-foreground hover:text-foreground"
          aria-label="Scroll tabs right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
};

const buildFileAncestors = (
  file: Doc<"files">,
  allFiles: Doc<"files">[],
): Doc<"files">[] => {
  const ancestors: Doc<"files">[] = [];
  const fileMap = new Map(allFiles.map((f) => [f._id, f]));

  let current: Doc<"files"> | undefined = file;
  while (current) {
    ancestors.unshift(current);
    current = current.parentId ? fileMap.get(current.parentId) : undefined;
  }

  return ancestors;
};

const sortItems = (items: Doc<"files">[]) =>
  [...items].sort((a, b) => {
    if (a.type === "folder" && b.type === "file") return -1;
    if (a.type === "file" && b.type === "folder") return 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

const BreadcrumbSegment = ({
  ancestor,
  isLast,
  allFiles,
  activeFileId,
  onOpenFile,
}: {
  ancestor: Doc<"files">;
  isLast: boolean;
  allFiles: Doc<"files">[];
  activeFileId: Id<"files">;
  onOpenFile: (fileId: Id<"files">) => void;
}) => {
  const siblings = useMemo(() => {
    const items = allFiles.filter((f) => f.parentId === ancestor.parentId);
    return sortItems(items);
  }, [allFiles, ancestor.parentId]);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent/50",
          isLast ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="shrink-0">
          <ItemIcon
            type={isLast ? ancestor.type : "folder"}
            name={ancestor.name}
            isOpen={!isLast}
            className="!size-3.5"
          />
        </span>
        <span className="text-xs">{ancestor.name}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="max-h-64 w-56 overflow-y-auto p-1"
      >
        {siblings.map((item) => {
          const isActive = item._id === activeFileId;
          return (
            <button
              key={item._id}
              type="button"
              onClick={() => {
                if (item.type === "file") {
                  onOpenFile(item._id);
                }
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground hover:bg-accent/50",
                item.type === "folder" && "opacity-70",
              )}
            >
              <span className="shrink-0">
                <ItemIcon
                  type={item.type}
                  name={item.name}
                  className="!size-4"
                />
              </span>
              <span className="min-w-0 truncate">{item.name}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

const BreadcrumbBar = ({
  file,
  allFiles,
  onOpenFile,
}: {
  file: Doc<"files">;
  allFiles: Doc<"files">[];
  onOpenFile: (fileId: Id<"files">) => void;
}) => {
  const ancestors = useMemo(
    () => buildFileAncestors(file, allFiles),
    [file, allFiles],
  );

  if (ancestors.length === 0) return null;

  return (
    <div
      className="flex h-7 items-center gap-0.5 border-b bg-background/50 px-2 overflow-x-auto scrollbar-none"
      style={{ scrollbarWidth: "none" }}
    >
      {ancestors.map((ancestor, index) => {
        const isLast = index === ancestors.length - 1;

        return (
          <span key={ancestor._id} className="flex shrink-0 items-center">
            {index > 0 && (
              <ChevronRightIcon className="size-3 text-muted-foreground/40" />
            )}
            <BreadcrumbSegment
              ancestor={ancestor}
              isLast={isLast}
              allFiles={allFiles}
              activeFileId={file._id}
              onOpenFile={onOpenFile}
            />
          </span>
        );
      })}
    </div>
  );
};

export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const {
    openTabs,
    activeTabId,
    previewTabId,
    openPreview,
    openPermanent,
    close,
    setActive,
  } = useEditor(projectId);
  const selectedFileId = activeTabId;

  const selectedFile = useFile({
    id: selectedFileId,
  });
  const projectFiles = useProjectFiles({ projectId });
  const updateFile = useUpdateFile();
  const convex = useConvex();

  const fetchFileForTab = useCallback(
    (fileId: Id<"files">) => {
      void convex.query(api.files.getFile, { id: fileId });
    },
    [convex],
  );

  const handleActivateTab = useCallback(
    (fileId: Id<"files">) => {
      setActive(fileId);
      fetchFileForTab(fileId);
    },
    [setActive, fetchFileForTab],
  );

  const handlePinTab = useCallback(
    (fileId: Id<"files">) => {
      openPermanent(fileId);
      fetchFileForTab(fileId);
    },
    [openPermanent, fetchFileForTab],
  );

  const fileNameById = useMemo(
    () => new Map((projectFiles ?? []).map((item) => [item._id, item.name])),
    [projectFiles],
  );

  const editorTabs = useMemo(
    () =>
      openTabs.map((fileId) => ({
        id: fileId,
        label: fileNameById.get(fileId) ?? "Deleted file",
      })),
    [openTabs, fileNameById],
  );

  useEffect(() => {
    if (selectedFileId && selectedFile === null) {
      close(selectedFileId);
    }
  }, [selectedFileId, selectedFile, close]);

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
        <div className="ml-auto flex h-full items-center gap-2 px-2">
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
      </nav>
      <div className="flex-1 relative">
        <div
          className={cn(
            "absolute inset-0",
            activeView === "editor" ? "visible" : "invisible",
          )}
        >
          <div className="relative h-full">
            <Allotment
              defaultSizes={[DEFAULT_SIDEBAR_WIDTH, DEFAULT_MAIN_SIZE]}
            >
              <Allotment.Pane
                snap
                minSize={MIN_SIDEBAR_WIDTH}
                maxSize={MAX_SIDEBAR_WIDTH}
                preferredSize={DEFAULT_SIDEBAR_WIDTH}
              >
                <FileExplorer
                  projectId={projectId}
                  selectedFileId={selectedFileId}
                  onSelectFile={(fileId, options) => {
                    if (!fileId) {
                      if (activeTabId) {
                        close(activeTabId);
                      }
                      return;
                    }

                    if (options?.pinned) {
                      openPermanent(fileId);
                      return;
                    }

                    openPreview(fileId);
                  }}
                />
              </Allotment.Pane>
              <Allotment.Pane>
                <div className="relative h-full">
                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2">
                    <span className="select-none text-[clamp(4.5rem,15vw,10rem)] font-semibold leading-none tracking-[0.14em] text-white/3">
                      Orbit
                    </span>
                  </div>
                  <div className="relative z-10 flex h-full min-h-0 flex-col">
                    <EditorTabStrip
                      tabs={editorTabs}
                      activeTabId={activeTabId}
                      previewTabId={previewTabId}
                      onActivate={handleActivateTab}
                      onPin={handlePinTab}
                      onClose={close}
                    />
                    {selectedFile && (
                      <BreadcrumbBar
                        file={selectedFile}
                        allFiles={projectFiles ?? []}
                        onOpenFile={handlePinTab}
                      />
                    )}
                    <div className="min-h-0 flex-1">
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
                        <div className="h-full">
                          <CodeEditor
                            value={draftContent}
                            onChange={setDraftContent}
                            filename={selectedFile.name}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Allotment.Pane>
            </Allotment>
          </div>
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
              <pre className="min-h-full rounded-lg border bg-muted/20 p-3 font-mono text-sm whitespace-pre-wrap wrap-break-word">
                {draftContent || "(empty file)"}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

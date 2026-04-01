"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Allotment } from "allotment";
import { useConvex, useConvexConnectionState } from "convex/react";
import {
  Clock3Icon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  LoaderCircleIcon,
  XIcon,
} from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";

import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
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
import {
  CodeEditor,
  type EditorRuntimeMeta,
} from "@/features/editor/components/code-editor";
import { EditorStatusBar } from "../../editor/components/editor-status-bar";
import { WelcomeTab } from "../../editor/components/welcome-tab";
import type { CursorState } from "../../editor/store/use-editor-store";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;
const AUTO_SAVE_DELAY_MS = 2000;
const AUTO_SAVE_RETRY_DELAY_MS = 3000;

// ── Empty state ─────────────────────────────────────────────────
const EmptyState = ({ label }: { label: string }) => {
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm">
      {label}
    </div>
  );
};

// ── Top view tab ────────────────────────────────────────────────
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

// ── Editor tab strip with context menu ──────────────────────────
const EditorTabStrip = ({
  tabs,
  activeTabId,
  previewTabId,
  onActivate,
  onPin,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
}: {
  tabs: Array<{ id: Id<"files">; label: string }>;
  activeTabId: Id<"files"> | null;
  previewTabId: Id<"files"> | null;
  onActivate: (fileId: Id<"files">) => void;
  onPin: (fileId: Id<"files">) => void;
  onClose: (fileId: Id<"files">) => void;
  onCloseOthers: (fileId: Id<"files">) => void;
  onCloseRight: (fileId: Id<"files">) => void;
  onCloseAll: () => void;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    fileId: Id<"files">;
  } | null>(null);

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

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    window.addEventListener("contextmenu", handler);
    return () => {
      window.removeEventListener("click", handler);
      window.removeEventListener("contextmenu", handler);
    };
  }, [contextMenu]);

  const scroll = useCallback((direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT,
      behavior: "smooth",
    });
  }, []);

  // Middle-click to close tab
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, fileId: Id<"files">) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(fileId);
      }
    },
    [onClose],
  );

  // Right-click context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, fileId: Id<"files">) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, fileId });
    },
    [],
  );

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="relative flex h-8.75 items-end border-b border-[#252526] bg-[#252526]">
      {/* Left scroll button */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          className="absolute left-0 z-10 flex h-full w-6 items-center justify-center bg-linear-to-r from-[#252526] to-transparent text-[#858585] hover:text-[#cccccc]"
          aria-label="Scroll tabs left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
      )}

      {/* Scrollable tab container */}
      <div
        ref={scrollRef}
        className="flex h-full w-full items-end overflow-x-auto scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const isPreview = previewTabId === tab.id;

          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={cn(
                "group relative flex h-8.75 w-40 shrink-0 items-center gap-1.5 border-r border-[#252526] px-2.5",
                isActive
                  ? "bg-[#1e1e1e] text-[#ffffff]"
                  : "bg-[#2d2d2d] text-[#969696] hover:bg-[#2d2d2dee]",
              )}
            >
              {/* Active tab top border accent */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-px bg-[#007acc]" />
              )}

              {/* File-type icon */}
              <span className="shrink-0">
                <ItemIcon type="file" name={tab.label} />
              </span>
              <button
                type="button"
                onClick={() => onActivate(tab.id)}
                onDoubleClick={() => onPin(tab.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px]"
                title={tab.label}
              >
                <span className={cn(isPreview && "italic")}>{tab.label}</span>
              </button>

              {/* Modified indicator + close button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:opacity-100! hover:bg-[#ffffff15]"
                aria-label={`Close ${tab.label}`}
              >
                <XIcon className="size-3.5" />
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
          className="absolute right-0 z-10 flex h-full w-6 items-center justify-center bg-linear-to-l from-[#252526] to-transparent text-[#858585] hover:text-[#cccccc]"
          aria-label="Scroll tabs right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-45 rounded-md border border-[#454545] bg-[#252526] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            {
              label: "Close",
              action: () => onClose(contextMenu.fileId),
              shortcut: "Ctrl+W",
            },
            {
              label: "Close Others",
              action: () => onCloseOthers(contextMenu.fileId),
            },
            {
              label: "Close to the Right",
              action: () => onCloseRight(contextMenu.fileId),
            },
            { label: "Close All", action: () => onCloseAll() },
            { divider: true } as {
              divider: true;
              label?: undefined;
              action?: undefined;
              shortcut?: undefined;
            },
            {
              label: "Keep Open",
              action: () => onPin(contextMenu.fileId),
            },
          ].map((item, i) =>
            "divider" in item && item.divider ? (
              <div
                key={`divider-${i}`}
                className="mx-2 my-1 border-t border-[#454545]"
              />
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.action?.();
                  setContextMenu(null);
                }}
                className="flex w-full items-center justify-between px-3 py-1 text-left text-[12px] text-[#cccccc] hover:bg-[#094771]"
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="ml-6 text-[11px] text-[#858585]">
                    {item.shortcut}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};

// ── Breadcrumb helpers ──────────────────────────────────────────
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
          "flex shrink-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-[#ffffff12]",
          isLast ? "text-[#cccccc]" : "text-[#858585]",
        )}
      >
        <span className="shrink-0">
          <ItemIcon
            type={isLast ? ancestor.type : "folder"}
            name={ancestor.name}
            isOpen={!isLast}
            className="size-3.5!"
          />
        </span>
        <span className="text-[11px]">{ancestor.name}</span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="max-h-64 w-56 overflow-y-auto p-1 bg-[#252526] border-[#454545]"
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
                  ? "bg-[#094771] text-white"
                  : "text-[#cccccc] hover:bg-[#ffffff12]",
                item.type === "folder" && "opacity-70",
              )}
            >
              <span className="shrink-0">
                <ItemIcon
                  type={item.type}
                  name={item.name}
                  className="size-4!"
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
      className="flex h-5.5 items-center gap-0.5 border-b border-[#2d2d2d] bg-[#1e1e1e] px-2 overflow-x-auto scrollbar-none"
      style={{ scrollbarWidth: "none" }}
    >
      {ancestors.map((ancestor, index) => {
        const isLast = index === ancestors.length - 1;

        return (
          <span key={ancestor._id} className="flex shrink-0 items-center">
            {index > 0 && (
              <ChevronRightIcon className="size-3 text-[#4a4a4a]" />
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

// ── Main component ──────────────────────────────────────────────
export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");
  const [draftContent, setDraftContent] = useState("");
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [cursorState, setCursorState] = useState<CursorState>({
    line: 1,
    col: 1,
    selectionCount: 1,
    selections: [{ anchor: 0, head: 0 }],
  });
  const [editorMeta, setEditorMeta] = useState<EditorRuntimeMeta>({
    totalLines: 1,
    lineEnding: "LF",
    language: "Plain Text",
  });

  const {
    openTabs,
    activeTabId,
    previewTabId,
    settings,
    updateSettings,
    openPreview,
    openPermanent,
    close,
    closeAll,
    closeOthers,
    closeRight,
    setActive,
    saveCursorState,
    restoreCursorState,
  } = useEditor(projectId);
  const selectedFileId = activeTabId;

  const selectedFile = useFile({
    id: selectedFileId,
  });
  const projectFiles = useProjectFiles({ projectId });
  const updateFile = useUpdateFile();
  const convex = useConvex();
  const connectionState = useConvexConnectionState();
  const isBackendConnected = connectionState.isWebSocketConnected;
  const autoSaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoSaveRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const saveInFlightRef = useRef(false);
  const queuedSaveRef = useRef<{ fileId: Id<"files">; content: string } | null>(
    null,
  );
  const lastSavedContentRef = useRef("");
  const draftContentRef = useRef("");
  const isDirtyRef = useRef(false);
  const selectedEditableFileIdRef = useRef<Id<"files"> | null>(null);
  const persistFileContentRef = useRef<
    (fileId: Id<"files">, content: string) => Promise<void>
  >(async () => {});

  useEffect(() => {
    lastSavedContentRef.current = lastSavedContent;
  }, [lastSavedContent]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current);
      }
      if (autoSaveRetryRef.current) {
        clearTimeout(autoSaveRetryRef.current);
      }
    };
  }, []);

  const fetchFileForTab = useCallback(
    (fileId: Id<"files">) => {
      void convex.query(api.files.getFile, { id: fileId });
    },
    [convex],
  );

  // Save cursor state before switching tabs
  const previousFileIdRef = useRef<Id<"files"> | null>(null);
  const hydratedFileIdRef = useRef<Id<"files"> | null>(null);
  const activeFileIdRef = useRef<Id<"files"> | null>(null);

  const handleActivateTab = (fileId: Id<"files">) => {
    if (fileId !== selectedFileId) {
      flushPendingAutoSave();
    }

    // Save current cursor state before switching
    if (previousFileIdRef.current) {
      saveCursorState(previousFileIdRef.current, cursorState);
    }
    setActive(fileId);
    fetchFileForTab(fileId);
  };

  // Track the active file for cursor state saving
  useEffect(() => {
    previousFileIdRef.current = selectedFileId;
    activeFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  const handlePinTab = (fileId: Id<"files">) => {
    if (fileId !== selectedFileId) {
      flushPendingAutoSave();
    }

    openPermanent(fileId);
    fetchFileForTab(fileId);
  };

  const handleCloseTab = (fileId: Id<"files">) => {
    if (fileId === selectedFileId) {
      flushPendingAutoSave();
    }

    // Save cursor state before closing
    if (fileId === selectedFileId) {
      saveCursorState(fileId, cursorState);
    }
    close(fileId);
  };

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
    if (selectedFile === undefined) {
      // Preserve local draft/autosave state while backend query is reconnecting.
      return;
    }

    if (selectedFile?.type === "file") {
      const content = selectedFile.content ?? "";
      const isNewFile = hydratedFileIdRef.current !== selectedFile._id;
      hydratedFileIdRef.current = selectedFile._id;

      const hasLocalUnsavedChanges =
        draftContentRef.current !== lastSavedContentRef.current;

      if (isNewFile || !hasLocalUnsavedChanges) {
        setDraftContent(content);
        setLastSavedContent(content);
        setAutoSaveError(null);
      }
    } else {
      hydratedFileIdRef.current = null;
      setDraftContent("");
      setLastSavedContent("");
      setAutoSaveError(null);
    }
  }, [selectedFile]);

  const hasEditableFileInSession =
    selectedFile?.type === "file" ||
    (selectedFile === undefined &&
      !!selectedFileId &&
      hydratedFileIdRef.current === selectedFileId);

  const isDirty = useMemo(() => {
    if (!hasEditableFileInSession) {
      return false;
    }

    return draftContent !== lastSavedContent;
  }, [draftContent, hasEditableFileInSession, lastSavedContent]);

  useEffect(() => {
    draftContentRef.current = draftContent;
  }, [draftContent]);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const clearAutoSaveRetry = useCallback(() => {
    if (autoSaveRetryRef.current) {
      clearTimeout(autoSaveRetryRef.current);
      autoSaveRetryRef.current = null;
    }
  }, []);

  const scheduleAutoSaveRetry = useCallback(() => {
    clearAutoSaveRetry();

    autoSaveRetryRef.current = setTimeout(() => {
      autoSaveRetryRef.current = null;

      const fileId = selectedEditableFileIdRef.current;
      if (!fileId || !isDirtyRef.current) {
        return;
      }

      void persistFileContentRef.current(fileId, draftContentRef.current);
    }, AUTO_SAVE_RETRY_DELAY_MS);
  }, [clearAutoSaveRetry]);

  const persistFileContent = useCallback(
    async function saveFile(fileId: Id<"files">, content: string) {
      if (!isMountedRef.current) {
        return;
      }

      if (saveInFlightRef.current) {
        queuedSaveRef.current = { fileId, content };
        return;
      }

      saveInFlightRef.current = true;
      setIsAutoSaving(true);
      setAutoSaveError(null);
      clearAutoSaveRetry();

      try {
        await updateFile({
          id: fileId,
          content,
        });

        if (isMountedRef.current && activeFileIdRef.current === fileId) {
          lastSavedContentRef.current = content;
          setLastSavedContent(content);
        }
      } catch (error) {
        if (isMountedRef.current) {
          setAutoSaveError(
            getErrorMessage(error, "Auto-save failed. Changes will retry."),
          );
          scheduleAutoSaveRetry();
        }
      } finally {
        saveInFlightRef.current = false;

        const queued = queuedSaveRef.current;
        queuedSaveRef.current = null;

        if (queued && isMountedRef.current) {
          await saveFile(queued.fileId, queued.content);
          return;
        }

        if (isMountedRef.current) {
          setIsAutoSaving(false);
        }
      }
    },
    [clearAutoSaveRetry, scheduleAutoSaveRetry, updateFile],
  );

  useEffect(() => {
    persistFileContentRef.current = persistFileContent;
  }, [persistFileContent]);

  function flushPendingAutoSave() {
    const fileId = selectedEditableFileIdRef.current;
    if (!fileId || !isDirtyRef.current) {
      return;
    }

    if (autoSaveDebounceRef.current) {
      clearTimeout(autoSaveDebounceRef.current);
      autoSaveDebounceRef.current = null;
    }

    clearAutoSaveRetry();

    void persistFileContentRef.current(fileId, draftContentRef.current);
  }

  const selectedEditableFileId =
    selectedFile?.type === "file"
      ? selectedFile._id
      : selectedFile === undefined
        ? hydratedFileIdRef.current === selectedFileId
          ? selectedEditableFileIdRef.current
          : null
        : selectedFile === null ||
            selectedFile?.type === "folder" ||
            !selectedFileId
          ? null
          : selectedEditableFileIdRef.current;

  useEffect(() => {
    selectedEditableFileIdRef.current = selectedEditableFileId;
  }, [selectedEditableFileId]);

  useEffect(() => {
    if (!selectedEditableFileId || !isDirty) {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current);
        autoSaveDebounceRef.current = null;
      }
      clearAutoSaveRetry();
      return;
    }

    if (autoSaveDebounceRef.current) {
      clearTimeout(autoSaveDebounceRef.current);
    }

    autoSaveDebounceRef.current = setTimeout(() => {
      autoSaveDebounceRef.current = null;

      const fileId = selectedEditableFileIdRef.current;
      if (!fileId || !isDirtyRef.current) {
        return;
      }

      void persistFileContentRef.current(fileId, draftContentRef.current);
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current);
        autoSaveDebounceRef.current = null;
      }
    };
  }, [clearAutoSaveRetry, draftContent, isDirty, selectedEditableFileId]);

  useEffect(() => {
    if (!isBackendConnected) {
      return;
    }

    const fileId = selectedEditableFileIdRef.current;
    if (!fileId || !isDirtyRef.current || saveInFlightRef.current) {
      return;
    }

    if (autoSaveDebounceRef.current || autoSaveRetryRef.current) {
      return;
    }

    void persistFileContentRef.current(fileId, draftContentRef.current);
  }, [isBackendConnected]);

  // Get initial cursor state for current file
  const initialCursorState = useMemo(() => {
    if (!selectedFileId) return undefined;
    return restoreCursorState(selectedFileId);
  }, [selectedFileId, restoreCursorState]);

  // Handle cursor changes from the editor
  const handleCursorStateChange = useCallback(
    (state: CursorState) => {
      setCursorState(state);
      if (selectedFileId) {
        saveCursorState(selectedFileId, state);
      }
    },
    [selectedFileId, saveCursorState],
  );

  // Compute file size for status bar
  const fileSize = useMemo(() => {
    if (!draftContent) return 0;
    return new TextEncoder().encode(draftContent).length;
  }, [draftContent]);

  const isOfflineWithUnsavedChanges = isDirty && !isBackendConnected;

  const autoSaveStatus = autoSaveError
    ? "error"
    : isOfflineWithUnsavedChanges
      ? "offline"
      : isAutoSaving
        ? "saving"
        : isDirty
          ? "pending"
          : "saved";

  const autoSaveStatusTitle =
    autoSaveStatus === "error"
      ? "Auto-save failed"
      : autoSaveStatus === "offline"
        ? "Disconnected from backend. Will save when reconnected"
        : autoSaveStatus === "saving"
          ? "Auto-saving"
          : autoSaveStatus === "pending"
            ? "Waiting to auto-save"
            : "Auto-saved";

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
          {selectedEditableFileId && (
            <Badge
              variant="outline"
              className={cn(
                "relative px-2.5 py-0.5 transition-colors",
                autoSaveStatus === "error" &&
                  "border-destructive/40 bg-destructive/10 text-destructive",
                autoSaveStatus === "offline" &&
                  "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
                autoSaveStatus === "saving" &&
                  "border-sky-500/40 bg-sky-500/10 text-sky-300",
                autoSaveStatus === "pending" &&
                  "border-amber-500/40 bg-amber-500/10 text-amber-300",
                autoSaveStatus === "saved" &&
                  "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
              )}
              title={autoSaveStatusTitle}
            >
              <span className="relative inline-flex size-4 items-center justify-center">
                {autoSaveStatus === "saving" && (
                  <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/60" />
                )}
                <CloudIcon
                  className={cn(
                    "relative z-10 size-4 transition-all",
                    autoSaveStatus === "saving" && "scale-105",
                    autoSaveStatus === "saved" &&
                      "drop-shadow-[0_0_4px_rgba(16,185,129,0.45)]",
                  )}
                />
                {autoSaveStatus === "error" ? (
                  <XIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-destructive/20 p-0.5" />
                ) : autoSaveStatus === "offline" ? (
                  <Clock3Icon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-zinc-500/20 p-0.5" />
                ) : autoSaveStatus === "saving" ? (
                  <LoaderCircleIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 animate-spin rounded-full bg-sky-500/20 p-0.5" />
                ) : autoSaveStatus === "pending" ? (
                  <Clock3Icon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-amber-500/20 p-0.5" />
                ) : (
                  <CheckIcon className="absolute -right-1.5 -bottom-1.5 z-20 size-3 rounded-full bg-emerald-500/20 p-0.5" />
                )}
              </span>
            </Badge>
          )}
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
                    if (fileId !== selectedFileId) {
                      flushPendingAutoSave();
                    }

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
                <div className="relative h-full flex flex-col">
                  {/* Watermark behind everything */}
                  <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2">
                    <span className="select-none text-[clamp(4.5rem,15vw,10rem)] font-semibold leading-none tracking-[0.14em] text-white/3">
                      Orbit
                    </span>
                  </div>

                  {/* Content area */}
                  <div className="relative z-10 flex h-full min-h-0 flex-col">
                    {/* Tab strip */}
                    <EditorTabStrip
                      tabs={editorTabs}
                      activeTabId={activeTabId}
                      previewTabId={previewTabId}
                      onActivate={handleActivateTab}
                      onPin={handlePinTab}
                      onClose={handleCloseTab}
                      onCloseOthers={closeOthers}
                      onCloseRight={closeRight}
                      onCloseAll={closeAll}
                    />

                    {/* Breadcrumb */}
                    {selectedFile && (
                      <BreadcrumbBar
                        file={selectedFile}
                        allFiles={projectFiles ?? []}
                        onOpenFile={handlePinTab}
                      />
                    )}

                    {/* Editor content */}
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {!selectedFileId && (
                        <WelcomeTab
                          projectId={projectId}
                          onOpenFile={handlePinTab}
                        />
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
                            key={selectedFile._id}
                            value={draftContent}
                            onChange={setDraftContent}
                            filename={selectedFile.name}
                            settings={settings}
                            initialCursorState={initialCursorState}
                            onCursorStateChange={handleCursorStateChange}
                            onMetaChange={setEditorMeta}
                            onBlur={flushPendingAutoSave}
                          />
                        </div>
                      )}
                    </div>

                    {/* Status bar */}
                    {selectedFile?.type === "file" && (
                      <EditorStatusBar
                        filename={selectedFile.name}
                        cursorState={cursorState}
                        settings={settings}
                        onUpdateSettings={updateSettings}
                        fileSize={fileSize}
                        isDirty={isDirty}
                        lineEnding={editorMeta.lineEnding}
                      />
                    )}
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

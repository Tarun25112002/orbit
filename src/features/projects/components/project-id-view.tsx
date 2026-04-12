"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Allotment } from "allotment";
import { useConvex, useConvexConnectionState } from "convex/react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";

import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/errors";
import {
  ORBIT_AI_EXECUTION_TRACE_EVENT,
  type AiPipelineOperation,
  type OrbitAiExecutionTraceEventDetail,
} from "@/lib/ai-execution";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Terminal } from "@/components/ai-elements/terminal";

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
import { buildProjectFilePathMap } from "@/features/editor/utils/codebase-context";
import { EditorStatusBar } from "../../editor/components/editor-status-bar";
import { WelcomeTab } from "../../editor/components/welcome-tab";
import type { CursorState } from "../../editor/store/use-editor-store";
import { useProjectHeaderContext } from "./project-header-context";
import { projectWebcontainerRuntime } from "../lib/webcontainer-runtime";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;
const AUTO_SAVE_DELAY_MS = 2000;
const AUTO_SAVE_RETRY_DELAY_MS = 3000;
const RUNTIME_LOG_LIMIT = 700;
const RUNTIME_DEV_SERVER_KEY = "dev-server";
const RUNTIME_DEV_SERVER_PORT = 4173;
const RUNTIME_FILE_SYNC_TIMEOUT_MS = 6000;

type RuntimePackageManager = "npm" | "pnpm" | "yarn" | "bun";

const isFilesystemOperation = (operation: AiPipelineOperation) =>
  operation.type === "create_file" ||
  operation.type === "create_folder" ||
  operation.type === "update_file" ||
  operation.type === "delete_path" ||
  operation.type === "rename_path";

const detectPackageManager = (filesByPath: Map<string, string>) => {
  if (filesByPath.has("pnpm-lock.yaml")) {
    return "pnpm" as const;
  }

  if (filesByPath.has("yarn.lock")) {
    return "yarn" as const;
  }

  if (filesByPath.has("bun.lockb") || filesByPath.has("bun.lock")) {
    return "bun" as const;
  }

  return "npm" as const;
};

const buildRuntimeDependencyFingerprint = (filesByPath: Map<string, string>) =>
  [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ]
    .map((path) => `${path}:${filesByPath.get(path) ?? ""}`)
    .join("\n");

const buildInstallCommand = (packageManager: RuntimePackageManager) => {
  if (packageManager === "pnpm") {
    return {
      command: "pnpm",
      commandArgs: ["install"],
      label: "pnpm install",
    };
  }

  if (packageManager === "yarn") {
    return {
      command: "yarn",
      commandArgs: ["install"],
      label: "yarn install",
    };
  }

  if (packageManager === "bun") {
    return {
      command: "bun",
      commandArgs: ["install"],
      label: "bun install",
    };
  }

  return {
    command: "npm",
    commandArgs: ["install"],
    label: "npm install",
  };
};

const buildDevServerCommand = (packageManager: RuntimePackageManager) => {
  if (packageManager === "yarn") {
    return {
      command: "yarn",
      commandArgs: [
        "dev",
        "--host",
        "0.0.0.0",
        "--port",
        String(RUNTIME_DEV_SERVER_PORT),
      ],
      label: "yarn dev",
    };
  }

  if (packageManager === "pnpm") {
    return {
      command: "pnpm",
      commandArgs: [
        "run",
        "dev",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        String(RUNTIME_DEV_SERVER_PORT),
      ],
      label: "pnpm run dev",
    };
  }

  if (packageManager === "bun") {
    return {
      command: "bun",
      commandArgs: [
        "run",
        "dev",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        String(RUNTIME_DEV_SERVER_PORT),
      ],
      label: "bun run dev",
    };
  }

  return {
    command: "npm",
    commandArgs: [
      "run",
      "dev",
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      String(RUNTIME_DEV_SERVER_PORT),
    ],
    label: "npm run dev",
  };
};

const tokenizeCommandLine = (value: string) => {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  return matches.map((token) => token.replace(/^(["'])|(["'])$/g, ""));
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const describeRuntimeOperation = (operation: AiPipelineOperation) => {
  if (operation.type === "run_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `run_command ${operation.command}${args ? ` ${args}` : ""}`;
  }

  if (operation.type === "start_background_command") {
    const args = operation.commandArgs?.join(" ") ?? "";
    return `start_background_command[${operation.key}] ${operation.command}${args ? ` ${args}` : ""}`;
  }

  if (operation.type === "rename_path") {
    return `${operation.type} ${operation.path} -> ${operation.newPath}`;
  }

  return `${operation.type} ${operation.path}`;
};

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, fileId: Id<"files">) => {
      if (e.button === 1) {
        e.preventDefault();
        onClose(fileId);
      }
    },
    [onClose],
  );

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
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-px bg-[#007acc]" />
              )}

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

export const ProjectIdView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const { setBadge } = useProjectHeaderContext();
  const [activeView, setActiveView] = useState<
    "editor" | "preview" | "runtime"
  >("editor");
  const [inlineSuggestionsEnabled, setInlineSuggestionsEnabled] =
    useState(true);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [runtimePreviewUrl, setRuntimePreviewUrl] = useState("");
  const [runtimeCommand, setRuntimeCommand] = useState("");
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
  const [isRuntimeCommandRunning, setIsRuntimeCommandRunning] = useState(false);
  const [isPreviewBooting, setIsPreviewBooting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
  const runtimeExecutedMessagesRef = useRef(new Set<string>());
  const runtimeDependenciesFingerprintRef = useRef<string | null>(null);
  const runtimeDevServerStartedRef = useRef(false);
  const projectFileContentByPathRef = useRef(new Map<string, string>());
  const previewAutoLaunchTriedRef = useRef(false);
  const selectedEditableFileIdRef = useRef<Id<"files"> | null>(null);
  const persistFileContentRef = useRef<
    (fileId: Id<"files">, content: string) => Promise<void>
  >(async () => {});

  useEffect(() => {
    lastSavedContentRef.current = lastSavedContent;
  }, [lastSavedContent]);

  useEffect(() => {
    isMountedRef.current = true;
    const runtimeExecutedMessages = runtimeExecutedMessagesRef.current;

    return () => {
      isMountedRef.current = false;
      if (autoSaveDebounceRef.current) {
        clearTimeout(autoSaveDebounceRef.current);
        autoSaveDebounceRef.current = null;
      }
      if (autoSaveRetryRef.current) {
        clearTimeout(autoSaveRetryRef.current);
        autoSaveRetryRef.current = null;
      }
      queuedSaveRef.current = null;
      projectWebcontainerRuntime.teardown();
      runtimeExecutedMessages.clear();
      runtimeDependenciesFingerprintRef.current = null;
      runtimeDevServerStartedRef.current = false;
      previewAutoLaunchTriedRef.current = false;
    };
  }, []);

  const fetchFileForTab = useCallback(
    (fileId: Id<"files">) => {
      void convex.query(api.files.getFile, { id: fileId });
    },
    [convex],
  );

  const previousFileIdRef = useRef<Id<"files"> | null>(null);
  const hydratedFileIdRef = useRef<Id<"files"> | null>(null);
  const activeFileIdRef = useRef<Id<"files"> | null>(null);

  const handleActivateTab = (fileId: Id<"files">) => {
    if (fileId !== selectedFileId) {
      flushPendingAutoSave();
    }

    if (previousFileIdRef.current) {
      saveCursorState(previousFileIdRef.current, cursorState);
    }
    setActive(fileId);
    fetchFileForTab(fileId);
  };

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

    if (fileId === selectedFileId) {
      saveCursorState(fileId, cursorState);
    }
    close(fileId);
  };

  const fileNameById = useMemo(
    () => new Map((projectFiles ?? []).map((item) => [item._id, item.name])),
    [projectFiles],
  );
  const filePathById = useMemo(
    () => buildProjectFilePathMap(projectFiles ?? []),
    [projectFiles],
  );
  const projectFileContentByPath = useMemo(() => {
    const byPath = new Map<string, string>();

    for (const item of projectFiles ?? []) {
      if (item.type !== "file") {
        continue;
      }

      const path = filePathById.get(item._id);
      if (!path) {
        continue;
      }

      byPath.set(path, item.content ?? "");
    }

    return byPath;
  }, [filePathById, projectFiles]);

  useEffect(() => {
    projectFileContentByPathRef.current = projectFileContentByPath;
  }, [projectFileContentByPath]);

  const appendRuntimeLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const line = `[${timestamp}] ${message}`;

    setRuntimeLogs((previous) => {
      const next = [...previous, line];
      if (next.length > RUNTIME_LOG_LIMIT) {
        return next.slice(next.length - RUNTIME_LOG_LIMIT);
      }

      return next;
    });
  }, []);

  const selectedFilePath = useMemo(() => {
    if (!selectedFileId) {
      return undefined;
    }

    return filePathById.get(selectedFileId);
  }, [filePathById, selectedFileId]);

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

  const initialCursorState = useMemo(() => {
    if (!selectedFileId) return undefined;
    return restoreCursorState(selectedFileId);
  }, [selectedFileId, restoreCursorState]);

  const handleCursorStateChange = useCallback(
    (state: CursorState) => {
      setCursorState(state);
      if (selectedFileId) {
        saveCursorState(selectedFileId, state);
      }
    },
    [selectedFileId, saveCursorState],
  );

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

  useEffect(() => {
    if (!selectedEditableFileId) {
      setBadge(null);
      return;
    }

    setBadge({
      status: autoSaveStatus,
      title: autoSaveStatusTitle,
    });
  }, [autoSaveStatus, autoSaveStatusTitle, selectedEditableFileId, setBadge]);

  useEffect(() => {
    return () => {
      setBadge(null);
    };
  }, [setBadge]);

  useEffect(() => {
    const unsubscribe = projectWebcontainerRuntime.onServerReady(
      ({ port, url }) => {
        setRuntimePreviewUrl(url);
        setPreviewError(null);
        setIsPreviewBooting(false);
        appendRuntimeLog(`Preview server ready on port ${port}: ${url}`);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [appendRuntimeLog]);

  const waitForRuntimeFileSync = useCallback(
    async (trace: OrbitAiExecutionTraceEventDetail["trace"]) => {
      const requiredByResults: string[] = [];
      for (const result of trace.operationResults) {
        if (result.status !== "applied") {
          continue;
        }

        if (
          result.operation.type === "create_file" ||
          result.operation.type === "update_file"
        ) {
          requiredByResults.push(result.operation.path);
        }
      }

      const requiredByOperations: string[] = [];
      for (const operation of trace.operations) {
        if (
          operation.type === "create_file" ||
          operation.type === "update_file"
        ) {
          requiredByOperations.push(operation.path);
        }
      }

      const requiredPaths =
        requiredByResults.length > 0 ? requiredByResults : requiredByOperations;

      if (requiredPaths.length === 0) {
        return;
      }

      const deadline = Date.now() + RUNTIME_FILE_SYNC_TIMEOUT_MS;

      while (Date.now() < deadline) {
        const filesByPath = projectFileContentByPathRef.current;
        if (requiredPaths.every((path) => filesByPath.has(path))) {
          return;
        }

        await wait(120);
      }

      appendRuntimeLog(
        "Timed out waiting for project file sync; proceeding with latest snapshot.",
      );
    },
    [appendRuntimeLog],
  );

  const syncProjectSnapshotToRuntime = useCallback(async () => {
    await projectWebcontainerRuntime.syncProjectFiles({
      filesByPath: projectFileContentByPathRef.current,
      log: appendRuntimeLog,
    });
  }, [appendRuntimeLog]);

  const maybeStartRuntimeDevServer = useCallback(async () => {
    if (
      runtimeDevServerStartedRef.current &&
      !projectWebcontainerRuntime.isBackgroundCommandRunning(
        RUNTIME_DEV_SERVER_KEY,
      )
    ) {
      runtimeDevServerStartedRef.current = false;
      setRuntimePreviewUrl("");
      appendRuntimeLog(
        "Detected stopped dev server process; attempting restart.",
      );
    }

    if (runtimeDevServerStartedRef.current) {
      return true;
    }

    const filesByPath = projectFileContentByPathRef.current;
    const packageJson = filesByPath.get("package.json");
    if (!packageJson) {
      appendRuntimeLog(
        "Skipping preview server start: package.json not found.",
      );
      return false;
    }

    let hasDevScript = false;
    try {
      const parsed = JSON.parse(packageJson) as {
        scripts?: Record<string, string>;
      };
      hasDevScript = typeof parsed.scripts?.dev === "string";
    } catch {
      appendRuntimeLog(
        "Skipping preview server start: package.json is invalid JSON.",
      );
      return false;
    }

    if (!hasDevScript) {
      appendRuntimeLog("Skipping preview server start: no dev script found.");
      return false;
    }

    const packageManager = detectPackageManager(filesByPath);
    const dependenciesFingerprint =
      buildRuntimeDependencyFingerprint(filesByPath);

    if (runtimeDependenciesFingerprintRef.current !== dependenciesFingerprint) {
      const install = buildInstallCommand(packageManager);
      appendRuntimeLog(`Installing dependencies with ${install.label}...`);
      const installExitCode = await projectWebcontainerRuntime.runCommand({
        command: install.command,
        commandArgs: install.commandArgs,
        log: appendRuntimeLog,
      });

      if (installExitCode !== 0) {
        appendRuntimeLog(
          `Dependency install failed with exit code ${installExitCode}.`,
        );
        return false;
      }

      runtimeDependenciesFingerprintRef.current = dependenciesFingerprint;
      appendRuntimeLog("Dependencies installed successfully.");
    }

    const devCommand = buildDevServerCommand(packageManager);

    appendRuntimeLog(
      `Starting ${devCommand.label} on port ${RUNTIME_DEV_SERVER_PORT}...`,
    );

    await projectWebcontainerRuntime.startBackgroundCommand({
      key: RUNTIME_DEV_SERVER_KEY,
      command: devCommand.command,
      commandArgs: devCommand.commandArgs,
      log: appendRuntimeLog,
    });

    runtimeDevServerStartedRef.current = true;
    return true;
  }, [appendRuntimeLog]);

  const ensurePreviewReady = useCallback(
    async (options?: { switchToPreview?: boolean; forceRestart?: boolean }) => {
      if (isPreviewBooting) {
        return;
      }

      if (options?.switchToPreview ?? true) {
        setActiveView("preview");
      }

      if (options?.forceRestart) {
        projectWebcontainerRuntime.stopBackgroundCommand({
          key: RUNTIME_DEV_SERVER_KEY,
          log: appendRuntimeLog,
        });
        runtimeDevServerStartedRef.current = false;
        setRuntimePreviewUrl("");
      }

      setPreviewError(null);
      setIsPreviewBooting(true);

      try {
        await projectWebcontainerRuntime.ensureBooted(appendRuntimeLog);
        await syncProjectSnapshotToRuntime();

        const started = await maybeStartRuntimeDevServer();
        if (!started) {
          throw new Error(
            "No runnable preview app was found. Ensure package.json has a dev script.",
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        setPreviewError(message);
        appendRuntimeLog(`Preview pipeline failed: ${message}`);
      } finally {
        setIsPreviewBooting(false);
      }
    },
    [
      appendRuntimeLog,
      isPreviewBooting,
      maybeStartRuntimeDevServer,
      syncProjectSnapshotToRuntime,
    ],
  );

  useEffect(() => {
    if (activeView !== "preview") {
      return;
    }

    if (runtimePreviewUrl || isPreviewBooting) {
      return;
    }

    if (previewAutoLaunchTriedRef.current) {
      return;
    }

    previewAutoLaunchTriedRef.current = true;
    void ensurePreviewReady({ switchToPreview: false });
  }, [activeView, ensurePreviewReady, isPreviewBooting, runtimePreviewUrl]);

  useEffect(() => {
    if (runtimePreviewUrl) {
      previewAutoLaunchTriedRef.current = false;
    }
  }, [runtimePreviewUrl]);

  const runAiExecutionTrace = useCallback(
    async (detail: OrbitAiExecutionTraceEventDetail) => {
      if (runtimeExecutedMessagesRef.current.has(detail.assistantMessageId)) {
        return;
      }

      runtimeExecutedMessagesRef.current.add(detail.assistantMessageId);
      setActiveView("runtime");
      setIsRuntimeBusy(true);
      appendRuntimeLog(
        `AI execution started for ${detail.assistantMessageId}.`,
      );

      try {
        await projectWebcontainerRuntime.ensureBooted(appendRuntimeLog);
        await waitForRuntimeFileSync(detail.trace);
        await syncProjectSnapshotToRuntime();

        if (detail.trace.operations.length === 0) {
          appendRuntimeLog(
            "No pipeline operations were planned for this request.",
          );
        }

        const hasBackgroundRuntimeOperation = detail.trace.operations.some(
          (operation) => operation.type === "start_background_command",
        );
        const previewRequestedByOperations = detail.trace.operations.some(
          (operation) =>
            operation.type === "start_background_command" &&
            operation.key === RUNTIME_DEV_SERVER_KEY,
        );

        for (const [index, operation] of detail.trace.operations.entries()) {
          appendRuntimeLog(
            `Step ${index + 1}/${detail.trace.operations.length}: ${describeRuntimeOperation(operation)}`,
          );

          const result = detail.trace.operationResults[index];
          if (result) {
            const statusLabel = result.status.toUpperCase();
            const message = result.message.trim();
            appendRuntimeLog(
              `${statusLabel}: ${message || describeRuntimeOperation(result.operation)}`,
            );
          }

          if (result?.status === "failed") {
            appendRuntimeLog("Skipping failed step.");
            continue;
          }

          if (result?.status === "skipped") {
            appendRuntimeLog(
              isFilesystemOperation(operation)
                ? "Skipping filesystem step marked as skipped."
                : "Skipping step marked as skipped.",
            );
            continue;
          }

          if (isFilesystemOperation(operation)) {
            await projectWebcontainerRuntime.applyOperation({
              operation,
              readFileContentByPath: (path) =>
                projectFileContentByPathRef.current.get(path),
            });
            continue;
          }

          if (operation.type === "run_command") {
            appendRuntimeLog(
              `$ ${operation.command}${operation.commandArgs?.length ? ` ${operation.commandArgs.join(" ")}` : ""}`,
            );
            const exitCode = await projectWebcontainerRuntime.runCommand({
              command: operation.command,
              commandArgs: operation.commandArgs,
              log: appendRuntimeLog,
            });
            appendRuntimeLog(`Command exited with code ${exitCode}.`);
            continue;
          }

          if (operation.type === "start_background_command") {
            if (operation.key === RUNTIME_DEV_SERVER_KEY) {
              appendRuntimeLog(
                "Starting managed preview dev server pipeline...",
              );
              const started = await maybeStartRuntimeDevServer();
              if (!started) {
                appendRuntimeLog(
                  "Managed preview startup skipped: no runnable dev server found.",
                );
              }
              continue;
            }

            appendRuntimeLog(
              `Starting background command (${operation.key}): ${operation.command}${operation.commandArgs?.length ? ` ${operation.commandArgs.join(" ")}` : ""}`,
            );
            await projectWebcontainerRuntime.startBackgroundCommand({
              key: operation.key,
              command: operation.command,
              commandArgs: operation.commandArgs,
              log: appendRuntimeLog,
            });

            if (operation.key === RUNTIME_DEV_SERVER_KEY) {
              runtimeDevServerStartedRef.current = true;
            }

            continue;
          }
        }

        if (!hasBackgroundRuntimeOperation || previewRequestedByOperations) {
          const previewStarted = await maybeStartRuntimeDevServer();
          if (previewStarted) {
            setActiveView("preview");
          }
        }
      } catch (error) {
        runtimeExecutedMessagesRef.current.delete(detail.assistantMessageId);
        appendRuntimeLog(
          `Execution pipeline failed: ${
            error instanceof Error ? error.message : String(error ?? "unknown")
          }`,
        );
      } finally {
        setIsRuntimeBusy(false);
      }
    },
    [
      appendRuntimeLog,
      maybeStartRuntimeDevServer,
      syncProjectSnapshotToRuntime,
      waitForRuntimeFileSync,
    ],
  );

  useEffect(() => {
    const onExecutionTrace = (event: Event) => {
      const customEvent =
        event as CustomEvent<OrbitAiExecutionTraceEventDetail>;
      if (!customEvent.detail) {
        return;
      }

      void runAiExecutionTrace(customEvent.detail);
    };

    window.addEventListener(
      ORBIT_AI_EXECUTION_TRACE_EVENT,
      onExecutionTrace as EventListener,
    );

    return () => {
      window.removeEventListener(
        ORBIT_AI_EXECUTION_TRACE_EVENT,
        onExecutionTrace as EventListener,
      );
    };
  }, [runAiExecutionTrace]);

  const handleRunRuntimeCommand = useCallback(async () => {
    const rawCommand = runtimeCommand.trim();
    if (!rawCommand || isRuntimeCommandRunning || isRuntimeBusy) {
      return;
    }

    const [command, ...commandArgs] = tokenizeCommandLine(rawCommand);
    if (!command) {
      return;
    }

    setRuntimeCommand("");
    setActiveView("runtime");
    setIsRuntimeCommandRunning(true);
    appendRuntimeLog(`$ ${rawCommand}`);

    try {
      await projectWebcontainerRuntime.ensureBooted(appendRuntimeLog);
      const exitCode = await projectWebcontainerRuntime.runCommand({
        command,
        commandArgs,
        log: appendRuntimeLog,
      });

      appendRuntimeLog(`Command exited with code ${exitCode}.`);
    } catch (error) {
      appendRuntimeLog(
        `Command failed: ${
          error instanceof Error ? error.message : String(error ?? "unknown")
        }`,
      );
    } finally {
      setIsRuntimeCommandRunning(false);
    }
  }, [
    appendRuntimeLog,
    isRuntimeBusy,
    isRuntimeCommandRunning,
    runtimeCommand,
  ]);

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
        <Tab
          label="Runtime"
          isActive={activeView === "runtime"}
          onClick={() => setActiveView("runtime")}
        />
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
                      onClose={handleCloseTab}
                      onCloseOthers={closeOthers}
                      onCloseRight={closeRight}
                      onCloseAll={closeAll}
                    />

                    {selectedFile && (
                      <BreadcrumbBar
                        file={selectedFile}
                        allFiles={projectFiles ?? []}
                        onOpenFile={handlePinTab}
                      />
                    )}

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
                            filePath={selectedFilePath}
                            settings={settings}
                            initialCursorState={initialCursorState}
                            onCursorStateChange={handleCursorStateChange}
                            onMetaChange={setEditorMeta}
                            onBlur={flushPendingAutoSave}
                            activeFileId={selectedFile._id}
                            projectFiles={projectFiles ?? []}
                            inlineSuggestionsEnabled={inlineSuggestionsEnabled}
                          />
                        </div>
                      )}
                    </div>

                    {selectedFile?.type === "file" && (
                      <EditorStatusBar
                        filename={selectedFile.name}
                        cursorState={cursorState}
                        settings={settings}
                        onUpdateSettings={updateSettings}
                        fileSize={fileSize}
                        isDirty={isDirty}
                        lineEnding={editorMeta.lineEnding}
                        inlineSuggestionsEnabled={inlineSuggestionsEnabled}
                        onToggleInlineSuggestions={() => {
                          setInlineSuggestionsEnabled((current) => !current);
                        }}
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
          <div className="flex h-full flex-col bg-[#111111]">
            <div className="flex h-10 items-center gap-2 border-b border-[#2d2d2d] px-3">
              <Button
                className="h-7 px-2.5 text-xs"
                disabled={isPreviewBooting || isRuntimeBusy}
                onClick={() => {
                  previewAutoLaunchTriedRef.current = true;
                  void ensurePreviewReady({
                    switchToPreview: false,
                    forceRestart: true,
                  });
                }}
                type="button"
              >
                {isPreviewBooting
                  ? "Starting..."
                  : runtimePreviewUrl
                    ? "Restart Preview"
                    : "Start Preview"}
              </Button>
              <Button
                className="h-7 px-2.5 text-xs"
                onClick={() => setActiveView("runtime")}
                type="button"
                variant="secondary"
              >
                Runtime Logs
              </Button>
              <Button
                className="h-7 px-2.5 text-xs"
                disabled={!runtimePreviewUrl}
                onClick={() => {
                  if (!runtimePreviewUrl) {
                    return;
                  }

                  window.open(
                    runtimePreviewUrl,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                type="button"
                variant="secondary"
              >
                Open New Tab
              </Button>
              <div className="ml-auto truncate text-[11px] text-[#8f8f8f]">
                {runtimePreviewUrl
                  ? `Live preview: ${runtimePreviewUrl}`
                  : isPreviewBooting
                    ? "Booting preview..."
                    : "Preview idle."}
              </div>
            </div>

            <div className="min-h-0 flex-1">
              {runtimePreviewUrl ? (
                <iframe
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  src={runtimePreviewUrl}
                  title="Generated app preview"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6">
                  <div className="max-w-xl text-center">
                    <p className="text-sm text-[#cccccc]">
                      Generate code, then launch preview to view the app output.
                    </p>
                    {previewError ? (
                      <p className="mt-2 text-xs text-red-300">
                        Preview failed: {previewError}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-[#8f8f8f]">
                        Preview uses WebContainer and your project dev script.
                      </p>
                    )}
                    <div className="mt-4 flex items-center justify-center gap-2">
                      <Button
                        className="h-8 px-3 text-xs"
                        disabled={isPreviewBooting || isRuntimeBusy}
                        onClick={() => {
                          previewAutoLaunchTriedRef.current = true;
                          void ensurePreviewReady({
                            switchToPreview: false,
                            forceRestart: true,
                          });
                        }}
                        type="button"
                      >
                        {isPreviewBooting ? "Starting..." : "Start Preview"}
                      </Button>
                      <Button
                        className="h-8 px-3 text-xs"
                        onClick={() => setActiveView("runtime")}
                        type="button"
                        variant="secondary"
                      >
                        View Runtime Logs
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className={cn(
            "absolute inset-0",
            activeView === "runtime" ? "visible" : "invisible",
          )}
        >
          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,24rem)] bg-[#111111]">
            <div className="border-b border-[#2d2d2d]">
              {runtimePreviewUrl ? (
                <iframe
                  className="h-full w-full"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  src={runtimePreviewUrl}
                  title="WebContainer preview"
                />
              ) : (
                <EmptyState label="Runtime preview will appear after a dev server starts." />
              )}
            </div>

            <div className="min-h-0 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input
                  className="h-8 bg-[#1f1f1f] text-xs text-[#d4d4d4]"
                  onChange={(event) => setRuntimeCommand(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }

                    event.preventDefault();
                    void handleRunRuntimeCommand();
                  }}
                  placeholder="Run command in WebContainer (for example: npm test)"
                  value={runtimeCommand}
                />
                <Button
                  className="h-8 px-3 text-xs"
                  disabled={
                    !runtimeCommand.trim() ||
                    isRuntimeCommandRunning ||
                    isRuntimeBusy
                  }
                  onClick={() => {
                    void handleRunRuntimeCommand();
                  }}
                  type="button"
                >
                  Run
                </Button>
                <Button
                  className="h-8 px-3 text-xs"
                  onClick={() => setRuntimeLogs([])}
                  type="button"
                  variant="secondary"
                >
                  Clear
                </Button>
              </div>

              <div className="mb-2 text-[11px] text-[#8f8f8f]">
                {isRuntimeBusy
                  ? "Applying AI execution steps in WebContainer..."
                  : isRuntimeCommandRunning
                    ? "Running command..."
                    : "Runtime idle."}
              </div>

              <Terminal
                className="h-[calc(100%-3rem)] border-[#2d2d2d]"
                isStreaming={isRuntimeBusy || isRuntimeCommandRunning}
                onClear={() => setRuntimeLogs([])}
                output={runtimeLogs.join("\n")}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

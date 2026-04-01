"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BracesIcon,
  IndentIncreaseIcon,
  TypeIcon,
  WrapTextIcon,
} from "lucide-react";

import type { CursorState, EditorSettings } from "../store/use-editor-store";
import { getLanguageName } from "../utils/language-detection";

// ── Props ───────────────────────────────────────────────────────
interface EditorStatusBarProps {
  filename: string;
  cursorState: CursorState;
  settings: EditorSettings;
  onUpdateSettings: (settings: Partial<EditorSettings>) => void;
  fileSize?: number;
  isDirty?: boolean;
  lineEnding?: "LF" | "CRLF";
}

// ── Helpers ─────────────────────────────────────────────────────
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ── Status bar segment ──────────────────────────────────────────
const StatusItem = ({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`flex shrink-0 items-center gap-1 px-2 py-0 h-full text-[11px] leading-none transition-colors ${
      onClick ? "hover:bg-[#ffffff1a] cursor-pointer" : "cursor-default"
    }`}
    disabled={!onClick}
  >
    {children}
  </button>
);

// ── Component ───────────────────────────────────────────────────
export const EditorStatusBar = ({
  filename,
  cursorState,
  settings,
  onUpdateSettings,
  fileSize,
  isDirty,
  lineEnding = "LF",
}: EditorStatusBarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compactMode, setCompactMode] = useState<"full" | "md" | "sm" | "xs">(
    "full",
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateCompactMode = () => {
      const width = element.clientWidth;

      if (width < 620) {
        setCompactMode("xs");
        return;
      }
      if (width < 760) {
        setCompactMode("sm");
        return;
      }
      if (width < 980) {
        setCompactMode("md");
        return;
      }

      setCompactMode("full");
    };

    updateCompactMode();
    const observer = new ResizeObserver(updateCompactMode);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const isFull = compactMode === "full";
  const isMdOrWider = compactMode === "full" || compactMode === "md";
  const isSmOrWider = compactMode !== "xs";

  const languageName = getLanguageName(filename);

  const toggleWordWrap = useCallback(() => {
    onUpdateSettings({ wordWrap: !settings.wordWrap });
  }, [onUpdateSettings, settings.wordWrap]);

  const toggleIndentType = useCallback(() => {
    onUpdateSettings({ insertSpaces: !settings.insertSpaces });
  }, [onUpdateSettings, settings.insertSpaces]);

  const cycleTabSize = useCallback(() => {
    const sizes = [2, 4, 8];
    const currentIndex = sizes.indexOf(settings.tabSize);
    const nextIndex = (currentIndex + 1) % sizes.length;
    onUpdateSettings({ tabSize: sizes[nextIndex] });
  }, [onUpdateSettings, settings.tabSize]);

  const cycleLineNumberMode = useCallback(() => {
    const nextMode: EditorSettings["lineNumbers"] =
      settings.lineNumbers === "on"
        ? "relative"
        : settings.lineNumbers === "relative"
          ? "off"
          : "on";
    onUpdateSettings({ lineNumbers: nextMode });
  }, [onUpdateSettings, settings.lineNumbers]);

  const cycleWhitespace = useCallback(() => {
    const order: EditorSettings["renderWhitespace"][] = [
      "none",
      "boundary",
      "selection",
      "all",
    ];
    const current = order.indexOf(settings.renderWhitespace);
    const next = order[(current + 1) % order.length];
    onUpdateSettings({ renderWhitespace: next });
  }, [onUpdateSettings, settings.renderWhitespace]);

  return (
    <div
      ref={containerRef}
      className="flex h-5.5 items-center border-t border-[#1e1e1e] bg-[#007acc] text-white select-none whitespace-nowrap overflow-hidden"
    >
      {/* ── Left side ─────────────────────────────── */}
      <div className="flex h-full min-w-0 items-center overflow-hidden">
        {/* Branch / dirty indicator */}
        {isDirty && (
          <StatusItem title="File has unsaved changes">
            <span className="inline-block size-1.5 rounded-full bg-white/80" />
          </StatusItem>
        )}

        {/* Cursor position */}
        <StatusItem title="Go to Line (Ctrl+G)">
          Ln {cursorState.line}, Col {cursorState.col}
        </StatusItem>
        {isSmOrWider && (
          <StatusItem title="Current selections">
            {cursorState.selectionCount > 1
              ? `${cursorState.selectionCount} selections`
              : "1 selection"}
          </StatusItem>
        )}
      </div>

      {/* ── Right side ────────────────────────────── */}
      <div className="ml-auto flex h-full min-w-0 items-center overflow-hidden">
        {/* Indent type */}
        <StatusItem onClick={toggleIndentType} title="Toggle indent type">
          <IndentIncreaseIcon className="size-3" />
          {settings.insertSpaces
            ? compactMode === "xs"
              ? "Sp"
              : "Spaces"
            : "Tabs"}
        </StatusItem>

        {/* Tab size */}
        {isSmOrWider && (
          <StatusItem onClick={cycleTabSize} title="Change tab size">
            {compactMode === "sm"
              ? `Tab:${settings.tabSize}`
              : `Tab Size: ${settings.tabSize}`}
          </StatusItem>
        )}

        {/* Encoding */}
        {isMdOrWider && <StatusItem title="File encoding">UTF-8</StatusItem>}

        {/* Line ending */}
        {isMdOrWider && (
          <StatusItem title="End of line sequence">{lineEnding}</StatusItem>
        )}

        {/* Line numbers mode */}
        {isMdOrWider && (
          <StatusItem
            onClick={cycleLineNumberMode}
            title="Cycle line number mode"
          >
            Line #{" "}
            {settings.lineNumbers === "relative"
              ? "Relative"
              : settings.lineNumbers === "off"
                ? "Off"
                : "On"}
          </StatusItem>
        )}

        {/* Whitespace rendering */}
        {isFull && (
          <StatusItem
            onClick={cycleWhitespace}
            title="Cycle whitespace rendering"
          >
            WS: {settings.renderWhitespace}
          </StatusItem>
        )}

        {/* Word wrap toggle */}
        <StatusItem onClick={toggleWordWrap} title="Toggle Word Wrap (Alt+Z)">
          <WrapTextIcon className="size-3" />
          {compactMode === "xs"
            ? "Wrap"
            : settings.wordWrap
              ? "Wrap"
              : "No Wrap"}
        </StatusItem>

        {/* Language */}
        <StatusItem title="Select language mode">
          <BracesIcon className="size-3" />
          {compactMode === "xs" ? languageName.split(" ")[0] : languageName}
        </StatusItem>

        {/* File size */}
        {fileSize !== undefined && isMdOrWider && (
          <StatusItem title="File size">
            <TypeIcon className="size-3" />
            {formatFileSize(fileSize)}
          </StatusItem>
        )}
      </div>
    </div>
  );
};

"use client";

import { useCallback } from "react";
import {
  BracesIcon,
  IndentIncreaseIcon,
  TypeIcon,
  WrapTextIcon,
  MapIcon,
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
    className={`flex items-center gap-1 px-2 py-0 h-full text-[11px] leading-none transition-colors ${
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
  const languageName = getLanguageName(filename);

  const toggleWordWrap = useCallback(() => {
    onUpdateSettings({ wordWrap: !settings.wordWrap });
  }, [onUpdateSettings, settings.wordWrap]);

  const toggleMinimap = useCallback(() => {
    onUpdateSettings({ minimap: !settings.minimap });
  }, [onUpdateSettings, settings.minimap]);

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
    <div className="flex h-[22px] items-center justify-between border-t border-[#1e1e1e] bg-[#007acc] text-white select-none">
      {/* ── Left side ─────────────────────────────── */}
      <div className="flex h-full items-center">
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
        <StatusItem title="Current selections">
          {cursorState.selectionCount > 1
            ? `${cursorState.selectionCount} selections`
            : "1 selection"}
        </StatusItem>
      </div>

      {/* ── Right side ────────────────────────────── */}
      <div className="flex h-full items-center">
        {/* Indent type */}
        <StatusItem onClick={toggleIndentType} title="Toggle indent type">
          <IndentIncreaseIcon className="size-3" />
          {settings.insertSpaces ? "Spaces" : "Tabs"}
        </StatusItem>

        {/* Tab size */}
        <StatusItem onClick={cycleTabSize} title="Change tab size">
          Tab Size: {settings.tabSize}
        </StatusItem>

        {/* Encoding */}
        <StatusItem title="File encoding">UTF-8</StatusItem>

        {/* Line ending */}
        <StatusItem title="End of line sequence">{lineEnding}</StatusItem>

        {/* Line numbers mode */}
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

        {/* Whitespace rendering */}
        <StatusItem
          onClick={cycleWhitespace}
          title="Cycle whitespace rendering"
        >
          WS: {settings.renderWhitespace}
        </StatusItem>

        {/* Word wrap toggle */}
        <StatusItem onClick={toggleWordWrap} title="Toggle Word Wrap (Alt+Z)">
          <WrapTextIcon className="size-3" />
          {settings.wordWrap ? "Wrap" : "No Wrap"}
        </StatusItem>

        {/* Minimap toggle */}
        <StatusItem onClick={toggleMinimap} title="Toggle minimap">
          <MapIcon className="size-3" />
        </StatusItem>

        {/* Language */}
        <StatusItem title="Select language mode">
          <BracesIcon className="size-3" />
          {languageName}
        </StatusItem>

        {/* File size */}
        {fileSize !== undefined && (
          <StatusItem title="File size">
            <TypeIcon className="size-3" />
            {formatFileSize(fileSize)}
          </StatusItem>
        )}
      </div>
    </div>
  );
};

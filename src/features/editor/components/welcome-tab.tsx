"use client";

import {
  FileIcon,
  FolderOpenIcon,
  KeyboardIcon,
  SparklesIcon,
} from "lucide-react";

// ── Keyboard shortcuts data ─────────────────────────────────────
const shortcuts = [
  { keys: "Ctrl+S", description: "Save file" },
  { keys: "Ctrl+F", description: "Find in file" },
  { keys: "Ctrl+H", description: "Find and replace" },
  { keys: "Ctrl+G", description: "Go to line" },
  { keys: "Ctrl+D", description: "Select next occurrence" },
  { keys: "Ctrl+/", description: "Toggle line comment" },
  { keys: "Ctrl+Shift+K", description: "Delete line" },
  { keys: "Alt+↑/↓", description: "Move line up/down" },
  { keys: "Ctrl+Shift+↑/↓", description: "Copy line up/down" },
  { keys: "Ctrl+Shift+[", description: "Fold region" },
  { keys: "Ctrl+Shift+]", description: "Unfold region" },
  { keys: "Ctrl+Space", description: "Trigger autocomplete" },
  { keys: "Tab", description: "Indent / accept suggestion" },
  { keys: "Alt+Z", description: "Toggle word wrap" },
  { keys: "Ctrl+Z", description: "Undo" },
  { keys: "Ctrl+Shift+Z", description: "Redo" },
];

// ── Component ───────────────────────────────────────────────────
export const WelcomeTab = () => {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-[#1e1e1e] p-8">
      <div className="w-full max-w-lg space-y-8">
        {/* ── Hero ──────────────────────────────────────── */}
        <div className="text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <SparklesIcon className="size-6 text-[#007acc]" />
            <h2 className="text-2xl font-semibold tracking-tight text-[#cccccc]">
              Welcome
            </h2>
          </div>
          <p className="text-sm text-[#858585]">
            Select a file from the explorer to start editing
          </p>
        </div>

        {/* ── Quick actions ─────────────────────────────── */}
        <div className="flex justify-center gap-6">
          <div className="flex items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#252526] px-4 py-2.5 text-xs text-[#cccccc]">
            <FileIcon className="size-3.5 text-[#007acc]" />
            Open a file
          </div>
          <div className="flex items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#252526] px-4 py-2.5 text-xs text-[#cccccc]">
            <FolderOpenIcon className="size-3.5 text-[#007acc]" />
            Browse explorer
          </div>
        </div>

        {/* ── Keyboard shortcuts ────────────────────────── */}
        <div className="rounded-lg border border-[#3c3c3c] bg-[#252526]/50">
          <div className="flex items-center gap-2 border-b border-[#3c3c3c] px-4 py-2.5">
            <KeyboardIcon className="size-4 text-[#007acc]" />
            <h3 className="text-xs font-medium text-[#cccccc]">
              Keyboard Shortcuts
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0 p-3">
            {shortcuts.map((shortcut) => (
              <div
                key={shortcut.keys}
                className="flex items-center justify-between gap-4 rounded px-2 py-1 transition-colors hover:bg-[#ffffff08]"
              >
                <span className="text-[11px] text-[#858585]">
                  {shortcut.description}
                </span>
                <kbd className="shrink-0 rounded border border-[#3c3c3c] bg-[#1e1e1e] px-1.5 py-0.5 font-mono text-[10px] text-[#9cdcfe]">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer tip ────────────────────────────────── */}
        <p className="text-center text-[10px] text-[#4a4a4a]">
          Tip: Double-click a file in the explorer to pin it as a permanent tab
        </p>
      </div>
    </div>
  );
};

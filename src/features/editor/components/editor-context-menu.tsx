"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface EditorContextMenuProps {
  children: React.ReactNode;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCommandPalette: () => void;
  onGoToSymbol: () => void;
  onGoToDefinition: () => void;
  onPeekDefinition: () => void;
  onRenameSymbol: () => void;
  onQuickFix: () => void;
  onSelectAll: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoToLine: () => void;
  onToggleLineComment: () => void;
  onToggleBlockComment: () => void;
  onFold: () => void;
  onUnfold: () => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
  onFormatDocument: () => void;
}

export const EditorContextMenu = ({
  children,
  onCut,
  onCopy,
  onPaste,
  onCommandPalette,
  onGoToSymbol,
  onGoToDefinition,
  onPeekDefinition,
  onRenameSymbol,
  onQuickFix,
  onSelectAll,
  onFind,
  onReplace,
  onGoToLine,
  onToggleLineComment,
  onToggleBlockComment,
  onFold,
  onUnfold,
  onFoldAll,
  onUnfoldAll,
  onFormatDocument,
}: EditorContextMenuProps) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block h-full w-full">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem onClick={onCut}>
          Cut
          <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopy}>
          Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPaste}>
          Paste
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onSelectAll}>
          Select All
          <ContextMenuShortcut>Ctrl+A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCommandPalette}>
          Command Palette
          <ContextMenuShortcut>F1</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onFind}>
          Find
          <ContextMenuShortcut>Ctrl+F</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onReplace}>
          Replace
          <ContextMenuShortcut>Ctrl+H</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onGoToLine}>
          Go to Line
          <ContextMenuShortcut>Ctrl+G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onGoToSymbol}>
          Go to Symbol
          <ContextMenuShortcut>Ctrl+Shift+O</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onGoToDefinition}>
          Go to Definition
          <ContextMenuShortcut>F12</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onPeekDefinition}>
          Peek Definition
          <ContextMenuShortcut>Alt+F12</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onRenameSymbol}>
          Rename Symbol
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onQuickFix}>
          Quick Fix
          <ContextMenuShortcut>Ctrl+.</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onToggleLineComment}>
          Toggle Line Comment
          <ContextMenuShortcut>Ctrl+/</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleBlockComment}>
          Toggle Block Comment
          <ContextMenuShortcut>Ctrl+Shift+A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onFold}>
          Fold Region
          <ContextMenuShortcut>Ctrl+Shift+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onUnfold}>
          Unfold Region
          <ContextMenuShortcut>Ctrl+Shift+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onFoldAll}>
          Fold All
          <ContextMenuShortcut>Ctrl+K Ctrl+0</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onUnfoldAll}>
          Unfold All
          <ContextMenuShortcut>Ctrl+K Ctrl+J</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onFormatDocument}>
          Format Document
          <ContextMenuShortcut>Shift+Alt+F</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

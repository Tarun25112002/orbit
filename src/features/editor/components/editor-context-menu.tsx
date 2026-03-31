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
  onSelectAll: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoToLine: () => void;
  onToggleLineComment: () => void;
  onToggleBlockComment: () => void;
  onFold: () => void;
  onUnfold: () => void;
  onFormatDocument: () => void;
}

export const EditorContextMenu = ({
  children,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onFind,
  onReplace,
  onGoToLine,
  onToggleLineComment,
  onToggleBlockComment,
  onFold,
  onUnfold,
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
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onFormatDocument}>
          Format Document
          <ContextMenuShortcut>Shift+Alt+F</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

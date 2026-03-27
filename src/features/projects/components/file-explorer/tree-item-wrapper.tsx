import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { getIndentGuideOffsets, getItemPadding } from "./constants";
import { Doc } from "../../../../../convex/_generated/dataModel";

export const TreeItemWrapper = ({
  item,
  children,
  actions,
  level,
  isActive,
  isExpanded,
  disabled,
  onClick,
  onContextMenu,
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
}: {
  item: Doc<"files">;
  children: React.ReactNode;
  actions?: React.ReactNode;
  level: number;
  isActive?: boolean;
  isExpanded?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onContextMenu?: () => void;
  onDoubleClick?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
}) => {
  const guideOffsets = getIndentGuideOffsets(level);

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">
        <div
          role="treeitem"
          aria-selected={isActive}
          aria-disabled={disabled || undefined}
          aria-level={level + 1}
          aria-expanded={item.type === "folder" ? isExpanded : undefined}
          tabIndex={disabled ? -1 : 0}
          onClick={disabled ? undefined : onClick}
          onContextMenu={disabled ? undefined : onContextMenu}
          onDoubleClick={disabled ? undefined : onDoubleClick}
          onKeyDown={(event) => {
            if (disabled) {
              return;
            }

            if ((event.key === "Enter" || event.key === " ") && onClick) {
              event.preventDefault();
              onClick();
              return;
            }

            if (event.key === "F2") {
              event.preventDefault();
              onRename?.();
            }

            if (
              event.key === "Delete" ||
              ((event.metaKey || event.ctrlKey) && event.key === "Backspace")
            ) {
              event.preventDefault();
              onDelete?.();
            }
          }}
          className={cn(
            "group relative flex h-6 w-full items-center gap-1 overflow-hidden rounded-md pr-1.5 text-left text-sm text-foreground/85 transition-colors outline-none hover:bg-accent/30 hover:text-foreground focus:ring-1 focus:ring-inset focus:ring-ring",
            isActive &&
              "bg-accent/40 text-foreground shadow-[inset_1px_0_0_var(--color-ring)]",
            disabled && "pointer-events-none opacity-50",
          )}
          style={{ paddingLeft: getItemPadding(level, item.type === "file") }}
        >
          {guideOffsets.length > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0"
            >
              {guideOffsets.map((offset) => (
                <span
                  key={offset}
                  className="absolute inset-y-1 w-px bg-border/45"
                  style={{ left: offset }}
                />
              ))}
            </div>
          )}
          {children}
          {actions}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        {item.type === "folder" && (
          <>
            <ContextMenuItem onClick={onCreateFile}>
              New File...
            </ContextMenuItem>
            <ContextMenuItem onClick={onCreateFolder}>
              New Folder...
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={onRename}>
          Rename...
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          Delete Permanently
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

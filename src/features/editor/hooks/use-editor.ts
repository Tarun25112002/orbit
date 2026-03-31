import { Id } from "../../../../convex/_generated/dataModel";
import { useCallback } from "react";
import { useEditorStore, type CursorState } from "../store/use-editor-store";

export const useEditor = (projectId: Id<"projects">) => {
  const tabState = useEditorStore((state) => state.getTabState(projectId));
  const openFile = useEditorStore((state) => state.openFile);
  const closeTab = useEditorStore((state) => state.closeTab);
  const closeAllTabs = useEditorStore((state) => state.closeAllTabs);
  const closeOtherTabs = useEditorStore((state) => state.closeOtherTabs);
  const closeTabsToRight = useEditorStore((state) => state.closeTabsToRight);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const reorderTab = useEditorStore((state) => state.reorderTab);
  const getCursorState = useEditorStore((state) => state.getCursorState);
  const setCursorState = useEditorStore((state) => state.setCursorState);
  const settings = useEditorStore((state) => state.settings);
  const updateSettings = useEditorStore((state) => state.updateSettings);

  const openPreview = useCallback(
    (fileId: Id<"files">) => {
      openFile(projectId, fileId, { pinned: false });
    },
    [openFile, projectId],
  );

  const openPermanent = useCallback(
    (fileId: Id<"files">) => {
      openFile(projectId, fileId, { pinned: true });
    },
    [openFile, projectId],
  );

  const close = useCallback(
    (fileId: Id<"files">) => {
      closeTab(projectId, fileId);
    },
    [closeTab, projectId],
  );

  const closeAll = useCallback(() => {
    closeAllTabs(projectId);
  }, [closeAllTabs, projectId]);

  const closeOthers = useCallback(
    (fileId: Id<"files">) => {
      closeOtherTabs(projectId, fileId);
    },
    [closeOtherTabs, projectId],
  );

  const closeRight = useCallback(
    (fileId: Id<"files">) => {
      closeTabsToRight(projectId, fileId);
    },
    [closeTabsToRight, projectId],
  );

  const setActive = useCallback(
    (fileId: Id<"files">) => {
      setActiveTab(projectId, fileId);
    },
    [projectId, setActiveTab],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderTab(projectId, fromIndex, toIndex);
    },
    [reorderTab, projectId],
  );

  const saveCursorState = useCallback(
    (fileId: Id<"files">, state: Partial<CursorState>) => {
      setCursorState(fileId, state);
    },
    [setCursorState],
  );

  const restoreCursorState = useCallback(
    (fileId: Id<"files">) => {
      return getCursorState(fileId);
    },
    [getCursorState],
  );

  return {
    ...tabState,
    settings,
    updateSettings,
    openPreview,
    openPermanent,
    close,
    closeAll,
    closeOthers,
    closeRight,
    setActive,
    reorder,
    saveCursorState,
    restoreCursorState,
  };
};

import { Id } from "../../../../convex/_generated/dataModel";
import { useCallback } from "react";
import { useEditorStore } from "../store/use-editor-store";

export const useEditor = (projectId: Id<"projects">) => {
  const tabState = useEditorStore((state) => state.getTabState(projectId));
  const openFile = useEditorStore((state) => state.openFile);
  const closeTab = useEditorStore((state) => state.closeTab);
  const closeAllTabs = useEditorStore((state) => state.closeAllTabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);

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

  const setActive = useCallback(
    (fileId: Id<"files">) => {
      setActiveTab(projectId, fileId);
    },
    [projectId, setActiveTab],
  );

  return {
    ...tabState,
    openPreview,
    openPermanent,
    close,
    closeAll,
    setActive,
  };
};

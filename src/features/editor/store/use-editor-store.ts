import { create } from "zustand";

import { Id } from "../../../../convex/_generated/dataModel";

interface TabState {
  openTabs: Id<"files">[];
  activeTabId: Id<"files"> | null;
  previewTabId: Id<"files"> | null;
}

const defaultTabState: TabState = {
  openTabs: [],
  activeTabId: null,
  previewTabId: null,
};

interface EditorStore {
  tabs: Map<Id<"projects">, TabState>;
  getTabState: (projectId: Id<"projects">) => TabState;
  openFile: (
    projectId: Id<"projects">,
    fileId: Id<"files">,
    options: { pinned: boolean },
  ) => void;
  closeTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  closeAllTabs: (projectId: Id<"projects">) => void;
  setActiveTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
}

const cloneTabState = (state: TabState): TabState => ({
  openTabs: [...state.openTabs],
  activeTabId: state.activeTabId,
  previewTabId: state.previewTabId,
});

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: new Map(),

  getTabState: (projectId) => get().tabs.get(projectId) ?? defaultTabState,

  openFile: (projectId, fileId, { pinned }) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      const hasPreviewTab =
        current.previewTabId !== null &&
        current.openTabs.includes(current.previewTabId);
      const isOpen = current.openTabs.includes(fileId);

      if (pinned) {
        if (!isOpen) {
          current.openTabs = [...current.openTabs, fileId];
        }

        current.activeTabId = fileId;
        if (current.previewTabId === fileId) {
          current.previewTabId = null;
        }
      } else {
        if (!isOpen) {
          if (hasPreviewTab && current.previewTabId) {
            current.openTabs = current.openTabs.map((id) =>
              id === current.previewTabId ? fileId : id,
            );
          } else {
            current.openTabs = [...current.openTabs, fileId];
          }
        }

        current.activeTabId = fileId;
        current.previewTabId = isOpen ? current.previewTabId : fileId;
      }

      tabs.set(projectId, current);
      return { tabs };
    });
  },

  closeTab: (projectId, fileId) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      if (!current.openTabs.includes(fileId)) {
        return store;
      }

      const closedTabIndex = current.openTabs.indexOf(fileId);
      current.openTabs = current.openTabs.filter((id) => id !== fileId);

      if (current.activeTabId === fileId) {
        if (current.openTabs.length === 0) {
          current.activeTabId = null;
        } else {
          const nextTabIndex = Math.min(
            closedTabIndex,
            current.openTabs.length - 1,
          );
          current.activeTabId = current.openTabs[nextTabIndex] ?? null;
        }
      }

      if (current.previewTabId === fileId) {
        current.previewTabId = null;
      }
      if (
        current.previewTabId !== null &&
        !current.openTabs.includes(current.previewTabId)
      ) {
        current.previewTabId = null;
      }

      if (current.openTabs.length === 0) {
        tabs.delete(projectId);
      } else {
        tabs.set(projectId, current);
      }

      return { tabs };
    });
  },

  closeAllTabs: (projectId) => {
    set((store) => {
      if (!store.tabs.has(projectId)) {
        return store;
      }

      const tabs = new Map(store.tabs);
      tabs.delete(projectId);
      return { tabs };
    });
  },

  setActiveTab: (projectId, fileId) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      if (!current.openTabs.includes(fileId)) {
        current.openTabs = [...current.openTabs, fileId];
      }
      current.activeTabId = fileId;

      tabs.set(projectId, current);
      return { tabs };
    });
  },
}));

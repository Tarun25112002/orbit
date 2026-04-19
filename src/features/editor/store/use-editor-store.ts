import { create } from "zustand";

import { Id } from "../../../../convex/_generated/dataModel";

export interface CursorState {
  line: number;
  col: number;
  selectionCount: number;
  selections: Array<{ anchor: number; head: number }>;
}

const defaultCursorState: CursorState = {
  line: 1,
  col: 1,
  selectionCount: 1,
  selections: [{ anchor: 0, head: 0 }],
};

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

export interface EditorSettings {
  wordWrap: boolean;
  minimap: boolean;
  fontSize: number;
  tabSize: number;
  insertSpaces: boolean;
  lineNumbers: "on" | "off" | "relative";
  renderWhitespace: "none" | "boundary" | "selection" | "all";
}

const defaultEditorSettings: EditorSettings = {
  wordWrap: false,
  minimap: true,
  fontSize: 13,
  tabSize: 2,
  insertSpaces: true,
  lineNumbers: "on",
  renderWhitespace: "none",
};

interface EditorStore {
  tabs: Map<Id<"projects">, TabState>;
  cursorStates: Map<string, CursorState>;
  settings: EditorSettings;

  getTabState: (projectId: Id<"projects">) => TabState;
  getCursorState: (fileId: Id<"files">) => CursorState;
  setCursorState: (fileId: Id<"files">, state: Partial<CursorState>) => void;
  updateSettings: (settings: Partial<EditorSettings>) => void;

  openFile: (
    projectId: Id<"projects">,
    fileId: Id<"files">,
    options: { pinned: boolean },
  ) => void;
  closeTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  closeAllTabs: (projectId: Id<"projects">) => void;
  closeOtherTabs: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  closeTabsToRight: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  setActiveTab: (projectId: Id<"projects">, fileId: Id<"files">) => void;
  reorderTab: (
    projectId: Id<"projects">,
    fromIndex: number,
    toIndex: number,
  ) => void;
}

const cloneTabState = (state: TabState): TabState => ({
  openTabs: [...state.openTabs],
  activeTabId: state.activeTabId,
  previewTabId: state.previewTabId,
});

export const useEditorStore = create<EditorStore>()((set, get) => ({
  tabs: new Map(),
  cursorStates: new Map(),
  settings: { ...defaultEditorSettings },

  getTabState: (projectId) => get().tabs.get(projectId) ?? defaultTabState,

  getCursorState: (fileId) =>
    get().cursorStates.get(fileId) ?? defaultCursorState,

  setCursorState: (fileId, partial) => {
    set((store) => {
      const cursorStates = new Map(store.cursorStates);
      const current = cursorStates.get(fileId) ?? { ...defaultCursorState };
      cursorStates.set(fileId, { ...current, ...partial });
      return { cursorStates };
    });
  },

  updateSettings: (newSettings) => {
    set((store) => ({
      settings: { ...store.settings, ...newSettings },
    }));
  },

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

  closeOtherTabs: (projectId, fileId) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      if (!current.openTabs.includes(fileId)) return store;

      current.openTabs = [fileId];
      current.activeTabId = fileId;
      current.previewTabId = null;

      tabs.set(projectId, current);
      return { tabs };
    });
  },

  closeTabsToRight: (projectId, fileId) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      const idx = current.openTabs.indexOf(fileId);
      if (idx === -1) return store;

      const removed = new Set(current.openTabs.slice(idx + 1));
      current.openTabs = current.openTabs.slice(0, idx + 1);

      if (current.activeTabId && removed.has(current.activeTabId)) {
        current.activeTabId = fileId;
      }
      if (current.previewTabId && removed.has(current.previewTabId)) {
        current.previewTabId = null;
      }

      tabs.set(projectId, current);
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

  reorderTab: (projectId, fromIndex, toIndex) => {
    set((store) => {
      const tabs = new Map(store.tabs);
      const current = cloneTabState(tabs.get(projectId) ?? defaultTabState);

      if (
        fromIndex < 0 ||
        fromIndex >= current.openTabs.length ||
        toIndex < 0 ||
        toIndex >= current.openTabs.length
      ) {
        return store;
      }

      const [moved] = current.openTabs.splice(fromIndex, 1);
      current.openTabs.splice(toIndex, 0, moved);

      tabs.set(projectId, current);
      return { tabs };
    });
  },
}));

import { create } from "zustand";

export interface Doc {
  id: string;
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FolderEntry[];
}

export interface PreviewPane {
  id: string;
  tabs: string[];
  activeTabId: string | null;
}

interface PendingAnchor {
  docId: string;
  fragment: string;
}

interface DocState {
  docs: Doc[];
  activeId: string | null;
  rootPath: string | null;
  tree: FolderEntry[];
  previewPanes: PreviewPane[];
  focusedPane: number;
  pendingAnchor: PendingAnchor | null;
  setActive: (id: string) => void;
  openDoc: (path: string, content: string) => void;
  updateDoc: (id: string, content: string) => void;
  closeDoc: (id: string) => void;
  markClean: (id: string, content: string) => void;
  replacePath: (oldPath: string, newPath: string) => void;
  removePath: (path: string) => void;
  setRoot: (path: string, tree: FolderEntry[]) => void;
  refreshTree: (tree: FolderEntry[]) => void;
  setTreeChildren: (path: string, children: FolderEntry[]) => void;
  splitPreview: (docId: string) => void;
  unsplitPreview: () => void;
  setFocusedPane: (index: number) => void;
  setPaneActiveTab: (paneIndex: number, docId: string) => void;
  moveTabToPane: (docId: string, fromPane: number, toPane: number, toIndex?: number) => void;
  collapseToSinglePreview: () => void;
  setPendingAnchor: (docId: string, fragment: string) => void;
  clearPendingAnchor: (docId: string, fragment: string) => void;
}

export const isPathInside = (path: string, parent: string) =>
  path === parent || path.startsWith(`${parent}/`) || path.startsWith(`${parent}\\`);

const basename = (path: string) => path.split(/[/\\]/).pop() || "untitled.md";

let paneCounter = 0;
const newPaneId = () => `pane-${++paneCounter}`;

const emptyPane = (): PreviewPane => ({ id: newPaneId(), tabs: [], activeTabId: null });

// Add (or activate) a doc in a pane; returns the updated pane.
function withTabActive(pane: PreviewPane, docId: string): PreviewPane {
  const tabs = pane.tabs.includes(docId) ? pane.tabs : [...pane.tabs, docId];
  return { ...pane, tabs, activeTabId: docId };
}

function withTabClosed(pane: PreviewPane, docId: string): PreviewPane {
  const index = pane.tabs.indexOf(docId);
  if (index < 0) return pane;
  const tabs = pane.tabs.filter((t) => t !== docId);
  const activeTabId =
    pane.activeTabId === docId
      ? (tabs[Math.min(index, tabs.length - 1)] ?? null)
      : pane.activeTabId;
  return { ...pane, tabs, activeTabId };
}

function mergePanes(panes: PreviewPane[], preferredIndex: number): PreviewPane | null {
  const first = panes[0];
  if (!first) return null;
  const tabs: string[] = [];
  for (const pane of panes) {
    for (const tab of pane.tabs) if (!tabs.includes(tab)) tabs.push(tab);
  }
  const preferred = panes[preferredIndex]?.activeTabId;
  const activeTabId =
    (preferred && tabs.includes(preferred) ? preferred : first.activeTabId) ?? tabs[0] ?? null;
  return { ...first, tabs, activeTabId };
}

export const useDocStore = create<DocState>((set) => ({
  docs: [],
  activeId: null,
  rootPath: null,
  tree: [],
  previewPanes: [],
  focusedPane: 0,
  pendingAnchor: null,

  setActive: (id) =>
    set((state) => {
      // Activation routes to the focused pane (preview mode); in single-pane mode
      // there is always one pane that holds every opened doc.
      const panes = state.previewPanes.length ? [...state.previewPanes] : [emptyPane()];
      const focusIdx = Math.min(state.focusedPane, panes.length - 1);
      // If the doc is already open in some pane, just activate that pane's tab and focus it.
      for (let i = 0; i < panes.length; i++) {
        if (panes[i].tabs.includes(id)) {
          panes[i] = withTabActive(panes[i], id);
          return { previewPanes: panes, focusedPane: i, activeId: id };
        }
      }
      panes[focusIdx] = withTabActive(panes[focusIdx], id);
      return { previewPanes: panes, focusedPane: focusIdx, activeId: id };
    }),

  openDoc: (path, content) =>
    set((state) => {
      const id = path;
      const existing = state.docs.find((d) => d.id === id);
      const docs = existing
        ? state.docs.map((d) => (d.id === id && !d.dirty ? { ...d, content } : d))
        : [...state.docs, { id, path, name: basename(path), content, dirty: false }];

      const panes = state.previewPanes.length ? [...state.previewPanes] : [emptyPane()];
      for (let i = 0; i < panes.length; i++) {
        if (panes[i].tabs.includes(id)) {
          panes[i] = withTabActive(panes[i], id);
          return { docs, previewPanes: panes, focusedPane: i, activeId: id };
        }
      }
      const focusIdx = Math.min(state.focusedPane, panes.length - 1);
      panes[focusIdx] = withTabActive(panes[focusIdx], id);
      return { docs, previewPanes: panes, focusedPane: focusIdx, activeId: id };
    }),

  updateDoc: (id, content) =>
    set((state) => ({
      docs: state.docs.map((d) => (d.id === id ? { ...d, content, dirty: true } : d)),
    })),

  closeDoc: (id) =>
    set((state) => {
      const index = state.docs.findIndex((d) => d.id === id);
      const docs = state.docs.filter((d) => d.id !== id);
      const activeId =
        state.activeId === id
          ? (docs[Math.min(index, docs.length - 1)]?.id ?? null)
          : state.activeId;
      const previewPanes = state.previewPanes.map((pane) => withTabClosed(pane, id));
      const pendingAnchor = state.pendingAnchor?.docId === id ? null : state.pendingAnchor;
      return { docs, activeId, previewPanes, pendingAnchor };
    }),

  markClean: (id, content) =>
    set((state) => ({
      docs: state.docs.map((d) =>
        d.id === id && d.content === content ? { ...d, dirty: false } : d
      ),
    })),

  replacePath: (oldPath, newPath) =>
    set((state) => {
      const move = (path: string) =>
        isPathInside(path, oldPath) ? `${newPath}${path.slice(oldPath.length)}` : path;
      const docs = state.docs.map((doc) => {
        const path = move(doc.path);
        return path === doc.path ? doc : { ...doc, id: path, path, name: basename(path) };
      });
      const previewPanes = state.previewPanes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map(move),
        activeTabId: pane.activeTabId ? move(pane.activeTabId) : null,
      }));
      return {
        docs,
        activeId: state.activeId ? move(state.activeId) : null,
        previewPanes,
        pendingAnchor: state.pendingAnchor
          ? { ...state.pendingAnchor, docId: move(state.pendingAnchor.docId) }
          : null,
      };
    }),

  removePath: (path) =>
    set((state) => {
      const activeIndex = state.docs.findIndex((doc) => doc.id === state.activeId);
      const docs = state.docs.filter((doc) => !isPathInside(doc.path, path));
      const activeId =
        state.activeId && isPathInside(state.activeId, path)
          ? (docs[Math.min(activeIndex, docs.length - 1)]?.id ?? null)
          : state.activeId;
      const removed = new Set(
        state.docs.filter((d) => isPathInside(d.path, path)).map((d) => d.id)
      );
      const previewPanes = state.previewPanes.map((pane) => {
        let next = pane;
        for (const id of removed) next = withTabClosed(next, id);
        return next;
      });
      const pendingAnchor =
        state.pendingAnchor && isPathInside(state.pendingAnchor.docId, path)
          ? null
          : state.pendingAnchor;
      return { docs, activeId, previewPanes, pendingAnchor };
    }),

  setRoot: (path, tree) =>
    set({
      rootPath: path,
      tree,
      docs: [],
      activeId: null,
      previewPanes: [],
      focusedPane: 0,
      pendingAnchor: null,
    }),

  refreshTree: (tree) => set({ tree }),

  setTreeChildren: (path, children) =>
    set((state) => {
      const update = (entries: FolderEntry[]): FolderEntry[] =>
        entries.map((entry) =>
          entry.path === path
            ? { ...entry, children }
            : entry.children
              ? { ...entry, children: update(entry.children) }
              : entry
        );
      return { tree: update(state.tree) };
    }),

  splitPreview: (docId) =>
    set((state) => {
      if (state.previewPanes.length >= 2) return state;
      const panes = state.previewPanes.length ? [...state.previewPanes] : [emptyPane()];
      // The doc moves out of the left pane and into a fresh right pane.
      panes[0] = withTabClosed(panes[0], docId);
      const right: PreviewPane = { id: newPaneId(), tabs: [docId], activeTabId: docId };
      return {
        previewPanes: [...panes, right],
        focusedPane: 1,
        activeId: docId,
      };
    }),

  unsplitPreview: () =>
    set((state) => {
      if (state.previewPanes.length < 2) return state;
      const merged = mergePanes(state.previewPanes, state.focusedPane);
      return {
        previewPanes: merged ? [merged] : [],
        focusedPane: 0,
        activeId: merged?.activeTabId ?? null,
      };
    }),

  setFocusedPane: (index) =>
    set((state) => {
      const clamped = Math.max(0, Math.min(index, state.previewPanes.length - 1));
      return {
        focusedPane: clamped,
        activeId: state.previewPanes[clamped]?.activeTabId ?? state.activeId,
      };
    }),

  setPaneActiveTab: (paneIndex, docId) =>
    set((state) => {
      const panes = [...state.previewPanes];
      const pane = panes[paneIndex];
      if (!pane) return state;
      panes[paneIndex] = withTabActive(pane, docId);
      return { previewPanes: panes, focusedPane: paneIndex, activeId: docId };
    }),

  moveTabToPane: (docId, fromPane, toPane, toIndex) =>
    set((state) => {
      const panes = [...state.previewPanes];
      const from = panes[fromPane];
      const to = panes[toPane];
      if (!from || !to || !from.tabs.includes(docId)) return state;

      const sourceIndex = from.tabs.indexOf(docId);
      const tabs = to.tabs.filter((id) => id !== docId);
      const requestedIndex = toIndex ?? to.tabs.length;
      const index = Math.max(
        0,
        Math.min(
          requestedIndex - (fromPane === toPane && sourceIndex < requestedIndex ? 1 : 0),
          tabs.length
        )
      );
      tabs.splice(index, 0, docId);

      if (fromPane === toPane) {
        panes[toPane] = { ...to, tabs, activeTabId: docId };
      } else {
        panes[fromPane] = withTabClosed(from, docId);
        panes[toPane] = { ...to, tabs, activeTabId: docId };
      }
      return {
        previewPanes: panes,
        focusedPane: toPane,
        activeId: docId,
      };
    }),

  collapseToSinglePreview: () =>
    set((state) => {
      if (state.previewPanes.length <= 1) return state;
      const merged = mergePanes(state.previewPanes, state.focusedPane);
      return {
        previewPanes: merged ? [merged] : [],
        focusedPane: 0,
        activeId: merged?.activeTabId ?? null,
      };
    }),

  setPendingAnchor: (docId, fragment) =>
    set({ pendingAnchor: fragment ? { docId, fragment } : null }),

  clearPendingAnchor: (docId, fragment) =>
    set((state) =>
      state.pendingAnchor?.docId === docId && state.pendingAnchor.fragment === fragment
        ? { pendingAnchor: null }
        : {}
    ),
}));

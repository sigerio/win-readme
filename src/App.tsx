import {
  useEffect,
  useMemo,
  useRef,
  useState,
  Fragment,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type UIEvent,
} from "react";
import {
  Code2,
  Columns2,
  Eye,
  FileText,
  ListTree,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Save,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { TAB_DRAG_TYPE, TAB_PANE_DRAG_TYPE, Tabs } from "./components/Tabs";
import { Editor } from "./components/Editor";
import { Preview } from "./components/Preview";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useDocStore } from "./store/docStore";
import { openFile, pickMarkdownFile, saveFile } from "./tauri/api";
import { getMarkdownToc } from "./markdown/toc";
import { t } from "./i18n";

type ViewMode = "editor" | "split" | "preview";

interface OpenDocumentPayload {
  path: string;
  content: string;
}

const viewModes: { value: ViewMode; labelKey: "editor" | "split" | "preview"; icon: typeof Code2 }[] = [
  { value: "editor", labelKey: "editor", icon: Code2 },
  { value: "split", labelKey: "split", icon: Columns2 },
  { value: "preview", labelKey: "preview", icon: Eye },
];

const ZOOM_KEY = "win-readme-zoom";
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
// First launch lands at 90% — the 100% layout reads oversized on Windows at
// common display scalings.
const ZOOM_DEFAULT = 0.9;

function currentZoom(): number {
  const stored = Number(localStorage.getItem(ZOOM_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : ZOOM_DEFAULT;
}

function setZoom(factor: number): Promise<void> {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
  return getCurrentWebview()
    .setZoom(clamped)
    .then(() => {
      zoomFactor = clamped;
      localStorage.setItem(ZOOM_KEY, String(clamped));
    })
    .catch((error) => console.error("setZoom failed:", error));
}

let zoomFactor = currentZoom();

function adjustZoom(delta: number): Promise<void> {
  return setZoom(Math.round((zoomFactor + delta) * 10) / 10);
}

function load<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : (JSON.parse(stored) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota errors are non-fatal for layout prefs */
  }
}

// Pointer-drag for resize handles. Returns the movement since drag start.
function useDrag(onMove: (dx: number, dy: number) => void) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (event: ReactMouseEvent) => {
    event.preventDefault();
    last.current = { x: event.clientX, y: event.clientY };
    const move = (e: MouseEvent) => {
      if (!last.current) return;
      onMove(e.clientX - last.current.x, e.clientY - last.current.y);
      last.current = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      last.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const docs = useDocStore((state) => state.docs);
  const activeId = useDocStore((state) => state.activeId);
  const rootPath = useDocStore((state) => state.rootPath);
  const previewPanes = useDocStore((state) => state.previewPanes);
  const focusedPane = useDocStore((state) => state.focusedPane);
  const setFocusedPane = useDocStore((state) => state.setFocusedPane);
  const collapseToSinglePreview = useDocStore((state) => state.collapseToSinglePreview);
  const moveTabToPane = useDocStore((state) => state.moveTabToPane);
  const openDoc = useDocStore((state) => state.openDoc);
  const markClean = useDocStore((state) => state.markClean);
  const doc = docs.find((item) => item.id === activeId);
  const hasDirtyDocs = docs.some((item) => item.dirty);
  const docContent = typeof doc?.content === "string" ? doc.content : "";
  const toc = useMemo(() => getMarkdownToc(docContent), [docContent]);
  const rootName = typeof rootPath === "string" ? rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath : null;
  const isPreviewSplit = viewMode === "preview" && previewPanes.length === 2;
  const [dropTarget, setDropTarget] = useState<{ pane: number; index: number } | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    load("win-readme-sidebar-collapsed", false)
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    load("win-readme-sidebar-width", 268)
  );
  const [outlineSide, setOutlineSide] = useState<"left" | "right">(() =>
    load("win-readme-outline-side", "right")
  );
  const [outlineCollapsed, setOutlineCollapsed] = useState(() =>
    load("win-readme-outline-collapsed", false)
  );
  const [outlineWidth, setOutlineWidth] = useState(() =>
    load("win-readme-outline-width", 220)
  );

  useEffect(() => save("win-readme-sidebar-collapsed", sidebarCollapsed), [sidebarCollapsed]);
  useEffect(() => save("win-readme-sidebar-width", sidebarWidth), [sidebarWidth]);
  useEffect(() => save("win-readme-outline-side", outlineSide), [outlineSide]);
  useEffect(() => save("win-readme-outline-collapsed", outlineCollapsed), [outlineCollapsed]);
  useEffect(() => save("win-readme-outline-width", outlineWidth), [outlineWidth]);

  const dragSidebar = useDrag((dx) =>
    setSidebarWidth((w) => Math.min(480, Math.max(160, w + dx)))
  );
  const dragOutline = useDrag((dx) =>
    setOutlineWidth((w) =>
      Math.min(400, Math.max(160, w + (outlineSide === "right" ? -dx : dx)))
    )
  );

  // Pane width ratios (0–1), persisted per split kind.
  const [splitRatio, setSplitRatio] = useState(() => load("win-readme-split-ratio", 0.5));
  const [previewSplitRatio, setPreviewSplitRatio] = useState(() =>
    load("win-readme-preview-split-ratio", 0.5)
  );
  useEffect(() => save("win-readme-split-ratio", splitRatio), [splitRatio]);
  useEffect(() => save("win-readme-preview-split-ratio", previewSplitRatio), [previewSplitRatio]);

  const mainRef = useRef<HTMLDivElement>(null);
  const clampRatio = (r: number) => Math.min(0.8, Math.max(0.2, r));
  const makeRatioDrag = (set: typeof setSplitRatio) =>
    useDrag((dx) => {
      const width = mainRef.current?.clientWidth ?? 0;
      if (width > 0) set((r) => clampRatio(r + dx / width));
    });
  const dragSplitRatio = makeRatioDrag(setSplitRatio);
  const dragPreviewSplitRatio = makeRatioDrag(setPreviewSplitRatio);

  const outlinePanel = doc && !outlineCollapsed && (
    <aside
      className={`outline-pane ${outlineSide}`}
      style={{ width: outlineWidth, flex: `0 0 ${outlineWidth}px` }}
    >
      <div className={`outline-resizer ${outlineSide}`} onMouseDown={dragOutline} />
      <header className="pane-header">
        <span>{t("outline")}</span>
        <div className="pane-header-actions">
          <button
            title={t("outlineFlip")}
            aria-label={t("outlineFlip")}
            onClick={() => setOutlineSide((s) => (s === "right" ? "left" : "right"))}
          >
            {outlineSide === "right" ? <PanelLeft size={13} /> : <PanelRight size={13} />}
          </button>
          <button
            title={t("outlineCollapse")}
            aria-label={t("outlineCollapse")}
            onClick={() => setOutlineCollapsed(true)}
          >
            {outlineSide === "right" ? <PanelRightClose size={13} /> : <PanelLeftClose size={13} />}
          </button>
        </div>
      </header>
      {toc.length ? (
        <nav className="outline-list" aria-label={t("outline")}>
          {toc.map((item) => (
            <button
              key={item.id}
              style={{ paddingLeft: `${(item.level - 1) * 10 + 12}px` }}
              title={item.text}
              onClick={() => scrollToLine(item.line)}
            >
              {item.text}
            </button>
          ))}
        </nav>
      ) : (
        <div className="outline-empty">{t("noOutline")}</div>
      )}
    </aside>
  );

  function tabDropIndex(section: HTMLElement, clientX: number) {
    const tabs = Array.from(section.querySelectorAll<HTMLElement>(".tabs > .tab"));
    const index = tabs.findIndex((tab) => clientX < tab.getBoundingClientRect().left + tab.offsetWidth / 2);
    return index < 0 ? tabs.length : index;
  }

  function dragOverPane(event: ReactDragEvent<HTMLElement>, pane: number) {
    if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ pane, index: tabDropIndex(event.currentTarget, event.clientX) });
  }

  function dropOnPane(event: ReactDragEvent<HTMLElement>, pane: number) {
    if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return;
    event.preventDefault();
    const docId = event.dataTransfer.getData(TAB_DRAG_TYPE);
    const source = event.dataTransfer.getData(TAB_PANE_DRAG_TYPE);
    const index = tabDropIndex(event.currentTarget, event.clientX);
    setDropTarget(null);
    if (docId && /^\d+$/.test(source)) moveTabToPane(docId, Number(source), pane, index);
  }

  // Leaving preview mode collapses any split back to a single pane.
  useEffect(() => {
    if (viewMode !== "preview") collapseToSinglePreview();
  }, [viewMode, collapseToSinglePreview]);

  async function saveActiveDoc() {
    if (!doc) return;
    const content = doc.content;
    try {
      await saveFile(doc.path, content);
      markClean(doc.id, content);
    } catch (error) {
      window.alert(t("saveFailed", { name: doc.name, error: String(error) }));
    }
  }

  async function openDocument() {
    try {
      const path = await pickMarkdownFile();
      if (path) openDoc(path, await openFile(path));
    } catch (error) {
      window.alert(t("openFileFailed", { error: String(error) }));
    }
  }

  useEffect(() => {
    if (!isTauri()) return;
    if (zoomFactor !== 1) void setZoom(zoomFactor);
    let disposed = false;
    let stopDocumentListener: (() => void) | undefined;
    let stopExitListener: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    void listen<OpenDocumentPayload>("open-document", ({ payload }) => {
      openDoc(payload.path, payload.content);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopDocumentListener = unlisten;
    });

    void invoke<OpenDocumentPayload | null>("startup_document").then((payload) => {
      if (!disposed && payload) openDoc(payload.path, payload.content);
    });

    // Rust intercepts the close request when unsaved docs exist and asks here.
    // Confirming clears dirty flags in Rust state (so its guard passes) then
    // destroys the window; cancel does nothing.
    void listen<number>("confirm-exit-dirty", () => {
      if (!window.confirm(t("exitUnsaved"))) return;
      const state = useDocStore.getState();
      void invoke("set_dirty_paths", { paths: [] }).then(() => {
        for (const doc of state.docs) if (doc.dirty) state.markClean(doc.id, doc.content);
        void appWindow.destroy();
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stopExitListener = unlisten;
    });

    return () => {
      disposed = true;
      stopDocumentListener?.();
      stopExitListener?.();
    };
  }, [openDoc]);

  // Keep the Rust close-guard's dirty list in sync with the store.
  const dirtyPaths = useMemo(
    () => docs.filter((d) => d.dirty).map((d) => d.path),
    [docs]
  );
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_dirty_paths", { paths: dirtyPaths });
  }, [dirtyPaths]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasDirtyDocs) return;
      event.preventDefault();
      event.returnValue = true;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void saveActiveDoc();
        return;
      }
      if (!isTauri()) return;
      if (key === "=" || key === "+") {
        event.preventDefault();
        void adjustZoom(0.1);
      } else if (key === "-") {
        event.preventDefault();
        void adjustZoom(-0.1);
      } else if (key === "0") {
        event.preventDefault();
        void setZoom(1);
      }
    }

    function handleWheel(event: WheelEvent) {
      if (!isTauri() || !event.ctrlKey) return;
      event.preventDefault();
      void adjustZoom(event.deltaY < 0 ? 0.1 : -0.1);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [doc, hasDirtyDocs, markClean]);

  const lineCount = doc ? docContent.split("\n").length : 0;
  const characterCount = docContent.length;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const scrollMax = (element: HTMLElement) => Math.max(0, element.scrollHeight - element.clientHeight);

  function editorLine(element: HTMLTextAreaElement) {
    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight) || 21;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    return Math.max(0, (element.scrollTop - paddingTop) / lineHeight);
  }

  function editorTop(element: HTMLTextAreaElement, line: number) {
    const style = getComputedStyle(element);
    return (Number.parseFloat(style.paddingTop) || 0) + line * (Number.parseFloat(style.lineHeight) || 21);
  }

  function previewHeadings(preview: HTMLDivElement) {
    return Array.from(
      preview.querySelectorAll<HTMLElement>(".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6")
    );
  }

  function headingTop(preview: HTMLDivElement, heading: HTMLElement) {
    return heading.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop;
  }

  function previewTopForLine(line: number, preview: HTMLDivElement) {
    const headings = previewHeadings(preview);
    const max = scrollMax(preview);
    if (!toc.length || !headings.length) return lineCount > 1 ? (line / (lineCount - 1)) * max : 0;

    const nextIndex = toc.findIndex((item) => item.line > line);
    const fromIndex = nextIndex <= 0 ? -1 : nextIndex - 1;
    const toIndex = nextIndex === -1 ? Math.min(toc.length, headings.length) : nextIndex;
    const fromLine = fromIndex < 0 ? 0 : toc[fromIndex].line;
    const toLine = toIndex >= toc.length ? Math.max(lineCount - 1, fromLine + 1) : toc[toIndex].line;
    const fromTop = fromIndex < 0 ? 0 : headingTop(preview, headings[fromIndex]);
    const toTop = toIndex >= headings.length ? max : headingTop(preview, headings[toIndex]);
    const ratio = toLine > fromLine ? clamp((line - fromLine) / (toLine - fromLine), 0, 1) : 0;
    return clamp(fromTop + (toTop - fromTop) * ratio, 0, max);
  }

  function editorTopForPreview(preview: HTMLDivElement, editor: HTMLTextAreaElement) {
    const headings = previewHeadings(preview);
    const max = scrollMax(editor);
    if (!toc.length || !headings.length) {
      return scrollMax(preview) > 0 ? (preview.scrollTop / scrollMax(preview)) * max : 0;
    }

    const tops = headings.map((heading) => headingTop(preview, heading));
    const nextIndex = tops.findIndex((top) => top > preview.scrollTop + 1);
    const fromIndex = nextIndex <= 0 ? -1 : nextIndex - 1;
    const toIndex = nextIndex === -1 ? Math.min(toc.length, headings.length) : nextIndex;
    const fromTop = fromIndex < 0 ? 0 : tops[fromIndex];
    const toTop = toIndex >= tops.length ? scrollMax(preview) : tops[toIndex];
    const fromLine = fromIndex < 0 ? 0 : toc[fromIndex].line;
    const toLine = toIndex >= toc.length ? Math.max(lineCount - 1, fromLine + 1) : toc[toIndex].line;
    const ratio = toTop > fromTop ? clamp((preview.scrollTop - fromTop) / (toTop - fromTop), 0, 1) : 0;
    return clamp(editorTop(editor, fromLine + (toLine - fromLine) * ratio), 0, max);
  }

  function syncFromEditor(source: HTMLTextAreaElement) {
    const preview = previewRef.current;
    if (syncingScrollRef.current || !preview) return;
    syncingScrollRef.current = true;
    preview.scrollTop = previewTopForLine(editorLine(source), preview);
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  function syncFromPreview(source: HTMLDivElement) {
    const editor = editorRef.current;
    if (syncingScrollRef.current || !editor) return;
    syncingScrollRef.current = true;
    editor.scrollTop = editorTopForPreview(source, editor);
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  function scrollToLine(line: number) {
    syncingScrollRef.current = true;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (editor) editor.scrollTop = clamp(editorTop(editor, line), 0, scrollMax(editor));
    if (preview) preview.scrollTop = previewTopForLine(line, preview);
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  return (
    <div className="app">
      <header className="app-bar">
        <div className="document-bar">
          <div className="breadcrumb" title={doc?.path || rootPath || ""}>
            <FileText size={15} />
            <span>{rootName || t("noWorkspace")}</span>
            {doc && (
              <>
                <span className="breadcrumb-separator">/</span>
                <strong>{doc.name}</strong>
              </>
            )}
          </div>
          <div className="document-actions">
            <div className="view-switcher" role="group" aria-label={t("documentView")}>
              {viewModes.map(({ value, labelKey, icon: Icon }) => {
                const label = t(labelKey);
                return (
                  <button
                    key={value}
                    className={viewMode === value ? "active" : ""}
                    title={t("viewMode", { label })}
                    aria-pressed={viewMode === value}
                    onClick={() => setViewMode(value)}
                  >
                    <Icon size={14} />
                    <span className="mode-label">{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              className="save-button"
              title={t("saveDocument")}
              aria-label={t("saveDocument")}
              disabled={!doc || !doc.dirty}
              onClick={() => void saveActiveDoc()}
            >
              <Save size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className="workbench">
        {sidebarCollapsed ? (
          <div className="sidebar-rail">
            <button
              title={t("sidebarExpand")}
              aria-label={t("sidebarExpand")}
              onClick={() => setSidebarCollapsed(false)}
            >
              <PanelLeft size={15} />
            </button>
          </div>
        ) : (
          <div className="sidebar-wrap" style={{ width: sidebarWidth, flex: `0 0 ${sidebarWidth}px` }}>
            <Sidebar />
            <div className="sidebar-resizer" onMouseDown={dragSidebar} />
            <button
              className="sidebar-collapse"
              title={t("sidebarCollapse")}
              aria-label={t("sidebarCollapse")}
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
        )}
        <main className="main">
          {doc && outlineCollapsed && (
            <button
              className={`outline-expand ${outlineSide}`}
              title={t("outlineExpand")}
              aria-label={t("outlineExpand")}
              onClick={() => setOutlineCollapsed(false)}
            >
              <ListTree size={14} />
            </button>
          )}
          {viewMode !== "preview" && <Tabs />}
          <ErrorBoundary key={doc?.id ?? "empty"}>
            {doc ? (
              <div className={`workspace ${viewMode} ${isPreviewSplit ? "preview-split" : ""}`}>
                {outlineSide === "left" && outlinePanel}
                <div className="workspace-main" ref={mainRef}>
                  {viewMode !== "preview" && (
                    <section
                      className="pane"
                      style={viewMode === "split" ? { flex: `${splitRatio} 1 0` } : undefined}
                    >
                      <header className="pane-header">
                        <span>{t("markdown")}</span>
                        <span>UTF-8</span>
                      </header>
                      <Editor
                        scrollRef={editorRef}
                        onScroll={(event: UIEvent<HTMLTextAreaElement>) => syncFromEditor(event.currentTarget)}
                      />
                    </section>
                  )}
                  {viewMode === "split" && (
                    <>
                      <div className="pane-resizer" onMouseDown={dragSplitRatio} />
                      <section className="pane" style={{ flex: `${1 - splitRatio} 1 0` }}>
                        <header className="pane-header">
                          <span>{t("previewPane")}</span>
                          <Eye size={13} />
                        </header>
                        <Preview
                          scrollRef={previewRef}
                          onScroll={(event: UIEvent<HTMLDivElement>) => syncFromPreview(event.currentTarget)}
                        />
                      </section>
                    </>
                  )}
                  {viewMode === "preview" &&
                    previewPanes.map((pane, index) => (
                      <Fragment key={pane.id}>
                        {index > 0 && (
                          <div className="pane-resizer" onMouseDown={dragPreviewSplitRatio} />
                        )}
                        <section
                          className={`pane preview-pane ${index === focusedPane ? "focused" : ""} ${dropTarget?.pane === index ? "drop-target" : ""}`}
                          style={
                            isPreviewSplit
                              ? { flex: `${index === 0 ? previewSplitRatio : 1 - previewSplitRatio} 1 0` }
                              : undefined
                          }
                          onMouseDown={() => setFocusedPane(index)}
                          onDragOver={(event) => dragOverPane(event, index)}
                          onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              setDropTarget(null);
                            }
                          }}
                          onDrop={(event) => dropOnPane(event, index)}
                        >
                          <Tabs
                            canSplit
                            paneIndex={index}
                            dropIndex={dropTarget?.pane === index ? dropTarget.index : null}
                            onTabDragEnd={() => setDropTarget(null)}
                          />
                          <header className="pane-header">
                            <span>
                              {docs.find((d) => d.id === pane.activeTabId)?.name ?? t("previewPane")}
                            </span>
                            <Eye size={13} />
                          </header>
                          {pane.activeTabId && (
                            <Preview
                              docId={pane.activeTabId}
                              scrollRef={pane.activeTabId === activeId ? previewRef : undefined}
                            />
                          )}
                        </section>
                      </Fragment>
                    ))}
                </div>
                {outlineSide === "right" && outlinePanel}
              </div>
            ) : (
              <div className="workspace-empty">
                <h1>{rootPath ? t("noDocument") : t("openDocument")}</h1>
                <p>{rootPath ? rootName : t("brand")}</p>
                {!rootPath && (
                  <button className="empty-action" onClick={() => void openDocument()}>
                    <FileText size={15} />
                    {t("openFile")}
                  </button>
                )}
              </div>
            )}
          </ErrorBoundary>
        </main>
      </div>

      <footer className="status-bar">
        <div className="status-left">
          <span className={doc?.dirty ? "status-dot dirty" : "status-dot"} />
          <span>{doc ? (doc.dirty ? t("unsaved") : t("saved")) : t("ready")}</span>
          {doc && <span className="status-secondary">Markdown</span>}
        </div>
        {doc && (
          <div className="status-right">
            <span>{t("lines", { n: lineCount })}</span>
            <span>{t("chars", { n: characterCount })}</span>
            <span>UTF-8</span>
          </div>
        )}
      </footer>
    </div>
  );
}

export default App;

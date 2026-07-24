import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Columns2, FileText, X } from "lucide-react";
import { useDocStore } from "../store/docStore";
import { t } from "../i18n";

interface TabMenuState {
  x: number;
  y: number;
  docId: string;
  paneIndex: number;
}

interface TabsProps {
  /** When true, tabs support split-to-side. Only enabled in preview view mode. */
  canSplit?: boolean;
  /** Which preview pane this tab row belongs to. Omit for the single global row. */
  paneIndex?: number;
  dropIndex?: number | null;
  onTabDragEnd?: () => void;
}

export const TAB_DRAG_TYPE = "application/x-win-readme-tab";
export const TAB_PANE_DRAG_TYPE = "application/x-win-readme-pane";

export function Tabs({
  canSplit = false,
  paneIndex,
  dropIndex = null,
  onTabDragEnd,
}: TabsProps) {
  const docs = useDocStore((s) => s.docs);
  const activeId = useDocStore((s) => s.activeId);
  const previewPanes = useDocStore((s) => s.previewPanes);
  const setActive = useDocStore((s) => s.setActive);
  const closeDoc = useDocStore((s) => s.closeDoc);
  const splitPreview = useDocStore((s) => s.splitPreview);
  const unsplitPreview = useDocStore((s) => s.unsplitPreview);
  const setPaneActiveTab = useDocStore((s) => s.setPaneActiveTab);
  const moveTabToPane = useDocStore((s) => s.moveTabToPane);
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    const frame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    );
    window.addEventListener("pointerdown", close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
    };
  }, [menu]);

  // Per-pane mode: this row shows only the pane's own tabs and active state.
  const pane = paneIndex !== undefined ? previewPanes[paneIndex] : undefined;
  const visibleDocs = pane
    ? (pane.tabs.map((id) => docs.find((d) => d.id === id)).filter(Boolean) as typeof docs)
    : docs;
  const rowActiveId = pane ? pane.activeTabId : activeId;

  function requestClose(id: string) {
    const doc = docs.find((item) => item.id === id);
    if (doc?.dirty && !window.confirm(t("closeWithoutSave", { name: doc.name }))) return;
    closeDoc(id);
  }

  function activate(id: string) {
    if (paneIndex !== undefined) setPaneActiveTab(paneIndex, id);
    else setActive(id);
  }

  function openMenu(event: ReactMouseEvent, docId: string) {
    if (!canSplit) return;
    event.preventDefault();
    showMenu(docId, event.clientX, event.clientY);
  }

  function showMenu(docId: string, x: number, y: number) {
    setMenu({
      x: Math.min(x, window.innerWidth - 200),
      y: Math.min(y, window.innerHeight - 100),
      docId,
      paneIndex: paneIndex ?? 0,
    });
  }

  const isSplit = previewPanes.length === 2;
  const canDrag = paneIndex !== undefined;

  return (
    <>
      <div
        className={`tabs ${dropIndex === visibleDocs.length ? "drop-at-end" : ""}`}
        role="tablist"
        aria-label={t("openDocs")}
      >
        {visibleDocs.map((doc, index) => (
          <div
            key={doc.id}
            className={`tab ${doc.id === rowActiveId ? "active" : ""} ${dropIndex === index ? "drop-before" : ""}`}
            role="tab"
            aria-selected={doc.id === rowActiveId}
            tabIndex={doc.id === rowActiveId ? 0 : -1}
            data-doc-id={doc.id}
            draggable={canDrag}
            onDragStart={canDrag ? (e) => {
              e.dataTransfer.setData(TAB_DRAG_TYPE, doc.id);
              e.dataTransfer.setData(TAB_PANE_DRAG_TYPE, String(paneIndex));
              e.dataTransfer.effectAllowed = "move";
            } : undefined}
            onDragEnd={canDrag ? onTabDragEnd : undefined}
            onClick={() => activate(doc.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                activate(doc.id);
                return;
              }
              if (e.key === "Delete") {
                e.preventDefault();
                requestClose(doc.id);
                return;
              }
              if (canSplit && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                showMenu(doc.id, rect.left + 20, rect.bottom);
                return;
              }
              const tabs = Array.from(
                e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
              );
              const index = tabs.indexOf(e.currentTarget);
              const next =
                e.key === "Home"
                  ? tabs[0]
                  : e.key === "End"
                    ? tabs[tabs.length - 1]
                    : e.key === "ArrowRight"
                      ? tabs[(index + 1) % tabs.length]
                      : e.key === "ArrowLeft"
                        ? tabs[(index - 1 + tabs.length) % tabs.length]
                        : null;
              const nextId = next?.dataset.docId;
              if (next && nextId) {
                e.preventDefault();
                activate(nextId);
                next.focus();
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                requestClose(doc.id);
              }
            }}
            onContextMenu={(e) => openMenu(e, doc.id)}
          >
            <FileText size={14} className="tab-icon" />
            <span className="tab-name">{doc.name}</span>
            {doc.dirty && <span className="dot" />}
            <button
              className="close"
              title={t("closeDoc", { name: doc.name })}
              onClick={(e) => {
                e.stopPropagation();
                requestClose(doc.id);
              }}
              aria-label={t("closeTab")}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menu.y, left: menu.x }}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenu(null);
          }}
        >
          {!isSplit && (
            <button
              role="menuitem"
              onClick={() => {
                splitPreview(menu.docId);
                setMenu(null);
              }}
            >
              <Columns2 size={14} />
              {t("splitRight")}
            </button>
          )}
          {isSplit && (
            <>
              <button
                role="menuitem"
                onClick={() => {
                  const targetPane = menu.paneIndex === 0 ? 1 : 0;
                  moveTabToPane(
                    menu.docId,
                    menu.paneIndex,
                    targetPane,
                    previewPanes[targetPane]?.tabs.length
                  );
                  setMenu(null);
                }}
              >
                <Columns2 size={14} />
                {t(menu.paneIndex === 0 ? "moveRight" : "moveLeft")}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  unsplitPreview();
                  setMenu(null);
                }}
              >
                <X size={14} />
                {t("unsplit")}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

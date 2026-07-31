import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { isPathInside, type FolderEntry, useDocStore } from "../store/docStore";
import {
  createFile,
  createFolder,
  joinPath,
  loadDirectory,
  movePath,
  openFile,
  parentPath,
  pickFolder,
  removeFile,
  removeFolder,
} from "../tauri/api";
import { t } from "../i18n";

interface ContextMenuState {
  x: number;
  y: number;
  entry: FolderEntry | null;
}

type ContextAction = "newFile" | "newFolder" | "delete";
type RunAction = (task: () => Promise<void>) => Promise<boolean>;

const isMarkdown = (name: string) => /\.(?:md|markdown)$/i.test(name);

function validateName(value: string): string {
  const name = value.trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error(t("invalidName"));
  }
  return name;
}

function TreeNode({
  entry,
  depth = 0,
  reload,
  run,
  showMenu,
}: {
  entry: FolderEntry;
  depth?: number;
  reload: () => Promise<void>;
  run: RunAction;
  showMenu: (entry: FolderEntry, x: number, y: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const openDoc = useDocStore((state) => state.openDoc);
  const replacePath = useDocStore((state) => state.replacePath);
  const setTreeChildren = useDocStore((state) => state.setTreeChildren);
  const activeId = useDocStore((state) => state.activeId);

  useEffect(() => {
    if (!expanded || entry.children !== undefined) return;
    let active = true;
    void loadDirectory(entry.path)
      .then((children) => {
        if (active) setTreeChildren(entry.path, children);
      })
      .catch((error) => {
        if (active) window.alert(String(error));
      });
    return () => {
      active = false;
    };
  }, [expanded, entry.children, entry.path, setTreeChildren]);

  async function openEntry() {
    await run(async () => openDoc(entry.path, await openFile(entry.path)));
  }

  async function toggleExpanded() {
    if (!expanded && entry.children === undefined) {
      const loaded = await run(async () => {
        setTreeChildren(entry.path, await loadDirectory(entry.path));
      });
      if (!loaded) return;
    }
    setExpanded((value) => !value);
  }

  function openKeyboardMenu(event: ReactKeyboardEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    showMenu(entry, rect.left + 20, rect.top + 20);
  }

  async function submitRename() {
    let name: string;
    try {
      name = validateName(renameValue);
    } catch (error) {
      window.alert(String(error));
      setRenameValue(entry.name);
      setRenaming(false);
      return;
    }

    if (name === entry.name) {
      setRenaming(false);
      return;
    }

    const newPath = joinPath(parentPath(entry.path), name);
    if (
      await run(async () => {
        await movePath(entry.path, newPath);
        replacePath(entry.path, newPath);
        await reload();
      })
    ) {
      setRenaming(false);
    }
  }

  const label = renaming ? (
    <input
      className="tree-rename"
      value={renameValue}
      onChange={(event) => setRenameValue(event.target.value)}
      onBlur={() => void submitRename()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setRenameValue(entry.name);
          setRenaming(false);
        }
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label={t("rename", { name: entry.name })}
      autoFocus
    />
  ) : (
    <span
      className={entry.isDirectory || isMarkdown(entry.name) ? undefined : "muted"}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setRenaming(true);
      }}
    >
      {entry.name}
    </span>
  );

  if (!entry.isDirectory) {
    const markdown = isMarkdown(entry.name);
    return (
      <div
        className={`tree-node file${markdown ? "" : " disabled"}${
          activeId === entry.path ? " active" : ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        onClick={() => {
          if (!markdown || renaming) return;
          void openEntry();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showMenu(entry, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openKeyboardMenu(event);
          } else if (markdown && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            void openEntry();
          }
        }}
        role="treeitem"
        tabIndex={0}
      >
        <FileText size={14} className={markdown ? "md" : "muted"} />
        {label}
      </div>
    );
  }

  return (
    <div>
      <div
        className="tree-node folder"
        style={{ paddingLeft: `${depth * 12}px` }}
        onClick={() => {
          if (!renaming) void toggleExpanded();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          showMenu(entry, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void toggleExpanded();
          } else if (event.key === "ArrowRight" && !expanded) {
            event.preventDefault();
            void toggleExpanded();
          } else if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            setExpanded(false);
          } else if (event.key === "F2") {
            event.preventDefault();
            setRenaming(true);
          } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            openKeyboardMenu(event);
          }
        }}
        role="treeitem"
        aria-expanded={expanded}
        tabIndex={0}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {expanded ? <FolderOpen size={14} /> : <Folder size={14} />}
        {label}
      </div>
      {expanded &&
        entry.children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            reload={reload}
            run={run}
            showMenu={showMenu}
          />
        ))}
    </div>
  );
}

export function Sidebar() {
  const tree = useDocStore((state) => state.tree);
  const docs = useDocStore((state) => state.docs);
  const rootPath = useDocStore((state) => state.rootPath);
  const setRoot = useDocStore((state) => state.setRoot);
  const refreshTree = useDocStore((state) => state.refreshTree);
  const openDoc = useDocStore((state) => state.openDoc);
  const reloadDoc = useDocStore((state) => state.reloadDoc);
  const removePath = useDocStore((state) => state.removePath);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshComplete, setRefreshComplete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const refreshCompleteTimer = useRef<number | null>(null);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    }
    if (!menu) return;
    const frame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    );
    window.addEventListener("pointerdown", closeMenu);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", closeMenu);
    };
  }, [menu]);

  useEffect(
    () => () => {
      if (refreshCompleteTimer.current !== null) clearTimeout(refreshCompleteTimer.current);
    },
    []
  );

  async function run(task: () => Promise<void>): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      window.alert(String(error));
      return false;
    }
  }

  async function reload() {
    if (!rootPath) return;
    const cleanDocs = docs.filter((doc) => !doc.dirty);
    const [tree, loadedDocs] = await Promise.all([
      loadDirectory(rootPath),
      Promise.all(
        cleanDocs.map(async (doc) => ({ id: doc.id, content: await openFile(doc.path) }))
      ),
    ]);
    refreshTree(tree);
    for (const doc of loadedDocs) reloadDoc(doc.id, doc.content);
  }

  async function refreshWorkspace() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshComplete(false);
    const refreshed = await run(reload);
    setRefreshing(false);
    if (!refreshed) return;
    setRefreshComplete(true);
    if (refreshCompleteTimer.current !== null) clearTimeout(refreshCompleteTimer.current);
    refreshCompleteTimer.current = window.setTimeout(() => setRefreshComplete(false), 700);
  }

  async function openFolder() {
    await run(async () => {
      const path = await pickFolder();
      if (!path) return;
      const nextTree = await loadDirectory(path);
      if (path === rootPath) {
        refreshTree(nextTree);
        return;
      }
      if (docs.some((doc) => doc.dirty) && !window.confirm(t("discardUnsaved"))) return;
      setRoot(path, nextTree);
    });
  }

  function promptName(label: string, initialValue: string): string | null {
    const value = window.prompt(label, initialValue);
    if (value === null) return null;
    try {
      return validateName(value);
    } catch (error) {
      window.alert(String(error));
      return null;
    }
  }

  async function createItem(directory: string, folder: boolean) {
    const name = promptName(
      folder ? t("newFolderName") : t("newFileName"),
      folder ? t("defaultFolder") : t("defaultFile")
    );
    if (!name) return;
    const path = joinPath(directory, name);
    await run(async () => {
      if (folder) {
        await createFolder(path);
      } else {
        await createFile(path);
        if (isMarkdown(name)) openDoc(path, "");
      }
      await reload();
    });
  }

  function showMenu(entry: FolderEntry | null, x: number, y: number) {
    setMenu({
      x: Math.min(x, window.innerWidth - 150),
      y: Math.min(y, window.innerHeight - 130),
      entry,
    });
  }

  async function handleContextAction(action: ContextAction) {
    if (!menu || !rootPath) return;
    const entry = menu.entry;
    setMenu(null);

    if (action === "newFile" || action === "newFolder") {
      await createItem(entry?.path ?? rootPath, action === "newFolder");
      return;
    }

    if (!entry) return;
    const hasDirtyDocs = docs.some((doc) => doc.dirty && isPathInside(doc.path, entry.path));
    const message = hasDirtyDocs ? "deleteDirtyConfirm" : "deleteConfirm";
    if (!window.confirm(t(message, { name: entry.name }))) return;
    await run(async () => {
      if (entry.isDirectory) await removeFolder(entry.path);
      else await removeFile(entry.path);
      removePath(entry.path);
      await reload();
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-actions">
          <button
            title={t("newFile")}
            aria-label={t("newFile")}
            disabled={!rootPath}
            onClick={() => rootPath && void createItem(rootPath, false)}
          >
            <FilePlus2 size={14} />
          </button>
          <button
            title={t("newFolder")}
            aria-label={t("newFolder")}
            disabled={!rootPath}
            onClick={() => rootPath && void createItem(rootPath, true)}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className={`refresh-button${refreshing ? " refreshing" : ""}${
              refreshComplete ? " refreshed" : ""
            }`}
            title={t(refreshing ? "refreshing" : refreshComplete ? "refreshed" : "refresh")}
            aria-label={t(refreshing ? "refreshing" : refreshComplete ? "refreshed" : "refresh")}
            aria-busy={refreshing}
            disabled={!rootPath || refreshing}
            onClick={() => void refreshWorkspace()}
          >
            <RefreshCw size={14} />
          </button>
          <button title={t("openFolder")} aria-label={t("openFolder")} onClick={() => void openFolder()}>
            <FolderOpen size={14} />
          </button>
        </div>
      </div>
      {rootPath && (
        <div className="workspace-header" title={rootPath}>
          <ChevronDown size={13} />
          <span>{rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath}</span>
        </div>
      )}
      <div
        className="tree"
        role="tree"
        onContextMenu={(event) => {
          if (rootPath && event.target === event.currentTarget) {
            event.preventDefault();
            showMenu(null, event.clientX, event.clientY);
          }
        }}
      >
        {tree.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            reload={reload}
            run={run}
            showMenu={showMenu}
          />
        ))}
        {!rootPath && (
          <div className="sidebar-empty">
            <FolderOpen size={22} />
            <span>{t("noFolderOpen")}</span>
          </div>
        )}
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
          {(menu.entry === null || menu.entry.isDirectory) && (
            <>
              <button role="menuitem" onClick={() => void handleContextAction("newFile")}>
                <FilePlus2 size={14} />
                {t("newFile")}
              </button>
              <button role="menuitem" onClick={() => void handleContextAction("newFolder")}>
                <FolderPlus size={14} />
                {t("newFolder")}
              </button>
            </>
          )}
          {menu.entry && (
            <>
              {menu.entry.isDirectory && <div className="divider" role="separator" />}
              <button role="menuitem" onClick={() => void handleContextAction("delete")}>
                <Trash2 size={14} />
                {t("delete")}
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

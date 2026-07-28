import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type UIEventHandler,
} from "react";
import { useDocStore } from "../store/docStore";
import { applyColor, BG_COLORS, TEXT_COLORS } from "../markdown/colors";
import { t } from "../i18n";

interface EditorProps {
  onScroll?: UIEventHandler<HTMLTextAreaElement>;
  scrollRef?: RefObject<HTMLTextAreaElement>;
}

interface MenuState {
  x: number;
  y: number;
  start: number;
  end: number;
}

export function Editor({ onScroll, scrollRef }: EditorProps) {
  const activeId = useDocStore((s) => s.activeId);
  const doc = useDocStore((s) => s.docs.find((d) => d.id === activeId));
  const updateDoc = useDocStore((s) => s.updateDoc);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const textareaRef = scrollRef ?? localRef;

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

  if (!doc) return <div className="editor empty">{t("openToEdit")}</div>;

  function showMenu(element: HTMLTextAreaElement, x: number, y: number): boolean {
    const { selectionStart: start, selectionEnd: end } = element;
    if (start === end) return false;
    setMenu({
      x: Math.min(x, window.innerWidth - 220),
      y: Math.min(y, window.innerHeight - 240),
      start,
      end,
    });
    return true;
  }

  function openMenu(event: ReactMouseEvent<HTMLTextAreaElement>) {
    const el = textareaRef.current;
    if (!el) return;
    if (showMenu(el, event.clientX, event.clientY)) event.preventDefault();
  }

  function openKeyboardMenu(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (showMenu(event.currentTarget, rect.left + 20, rect.top + 20)) event.preventDefault();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    openKeyboardMenu(event);
    if (event.nativeEvent.isComposing || (event.key !== "Home" && event.key !== "Enter")) return;
    const element = event.currentTarget;
    requestAnimationFrame(() => {
      element.scrollLeft = 0;
    });
  }

  function apply(kind: "text" | "bg" | null, color: string | null) {
    if (!menu || !doc) return;
    const next = applyColor(doc.content, menu.start, menu.end, kind, color);
    updateDoc(doc.id, next.text);
    setMenu(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.selStart, next.selEnd);
      }
    });
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        className="editor"
        value={doc.content}
        onChange={(e) => updateDoc(doc.id, e.target.value)}
        onScroll={onScroll}
        onContextMenu={openMenu}
        onKeyDown={handleKeyDown}
        aria-label={t("editing", { name: doc.name })}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
      />
      {menu && (
        <div
          ref={menuRef}
          className="context-menu color-menu"
          style={{ top: menu.y, left: menu.x }}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenu(null);
          }}
        >
          <div className="color-section">
            <span className="color-label">{t("textColor")}</span>
            <div className="color-row">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  className="color-swatch"
                  style={{ color: c.value }}
                  title={t("textColorNamed", { name: c.label })}
                  aria-label={t("textColorNamed", { name: c.label })}
                  onClick={() => apply("text", c.value)}
                >
                  A
                </button>
              ))}
            </div>
          </div>
          <div className="color-section">
            <span className="color-label">{t("bgColor")}</span>
            <div className="color-row">
              {BG_COLORS.map((c) => (
                <button
                  key={c.value}
                  className="color-swatch"
                  style={{ backgroundColor: c.value }}
                  title={t("bgColorNamed", { name: c.label })}
                  aria-label={t("bgColorNamed", { name: c.label })}
                  onClick={() => apply("bg", c.value)}
                >
                  A
                </button>
              ))}
            </div>
          </div>
          <div className="divider" role="separator" />
          <button role="menuitem" onClick={() => apply(null, null)}>
            {t("clearColor")}
          </button>
        </div>
      )}
    </>
  );
}

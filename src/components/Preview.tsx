import { useEffect, useRef, useState, type RefObject, type UIEventHandler } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { resolve } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useDocStore } from "../store/docStore";
import { renderMarkdown } from "../markdown/render";
import { hydrateMermaid } from "../markdown/mermaidHydrate";
import { headingAnchorIds } from "../markdown/toc";
import { openFile, parentPath } from "../tauri/api";
import { t } from "../i18n";
import "katex/dist/katex.min.css";

interface PreviewProps {
  onScroll?: UIEventHandler<HTMLDivElement>;
  scrollRef?: RefObject<HTMLDivElement>;
  /** Which doc to render. Defaults to the active doc. */
  docId?: string;
}

const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/i.test(path);
const isExternalUrl = (value: string) => /^(?:https?:|mailto:|tel:)/i.test(value);
const hasOtherProtocol = (value: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value);

async function resolveLocalPath(documentPath: string, reference: string): Promise<string> {
  const path = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
  return /^[a-z]:[\\/]/i.test(path) || /^[\\/]{2}/.test(path) || path.startsWith("/")
    ? path
    : resolve(parentPath(documentPath), path);
}

function scrollToHeading(root: HTMLElement, fragment: string): boolean {
  const ids = headingAnchorIds(fragment);
  const target = Array.from(root.querySelectorAll<HTMLElement>("[id]")).find((element) =>
    ids.includes(element.id)
  );
  target?.scrollIntoView({ block: "start" });
  return Boolean(target);
}

export function Preview({ onScroll, scrollRef, docId }: PreviewProps) {
  const activeId = useDocStore((s) => s.activeId);
  const targetId = docId ?? activeId;
  const doc = useDocStore((s) => s.docs.find((d) => d.id === targetId));
  const openDoc = useDocStore((s) => s.openDoc);
  const pendingAnchor = useDocStore((s) => s.pendingAnchor);
  const setPendingAnchor = useDocStore((s) => s.setPendingAnchor);
  const clearPendingAnchor = useDocStore((s) => s.clearPendingAnchor);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!doc) {
      setHtml("");
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderMarkdown(doc.content)
        .then((result) => {
          if (!cancelled) {
            setHtml(result);
            setError("");
          }
        })
        .catch((reason) => {
          if (!cancelled) setError(String(reason));
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc?.id, doc?.content]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || !doc || pendingAnchor?.docId !== doc.id) return;
    const { fragment } = pendingAnchor;
    const frame = requestAnimationFrame(() => {
      if (scrollToHeading(root, fragment)) clearPendingAnchor(doc.id, fragment);
    });
    return () => cancelAnimationFrame(frame);
  }, [html, doc?.id, pendingAnchor, clearPendingAnchor]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || !html || !doc) return;
    const currentRoot = root;
    const currentDoc = doc;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    async function enhance() {
      if (isTauri()) {
        await Promise.all(
          Array.from(currentRoot.querySelectorAll<HTMLImageElement>("img[src]")).map(async (image) => {
            const source = image.getAttribute("src") ?? "";
            if (
              !source ||
              source.startsWith("#") ||
              source.startsWith("//") ||
              isExternalUrl(source) ||
              hasOtherProtocol(source)
            ) {
              return;
            }
            const path = await resolveLocalPath(currentDoc.path, source);
            if (!cancelled) image.src = convertFileSrc(path);
          })
        );
      }

      for (const anchor of currentRoot.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        const handleClick = (event: MouseEvent) => {
          if (!href) return;
          if (href.startsWith("#")) {
            event.preventDefault();
            scrollToHeading(currentRoot, href);
            return;
          }
          if (isExternalUrl(href)) {
            event.preventDefault();
            void openUrl(href).catch((reason) => window.alert(String(reason)));
            return;
          }
          if (href.startsWith("//") || hasOtherProtocol(href)) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          void resolveLocalPath(currentDoc.path, href)
            .then(async (path) => {
              if (isMarkdownPath(path)) {
                const hashIndex = href.indexOf("#");
                const content = await openFile(path);
                setPendingAnchor(path, hashIndex >= 0 ? href.slice(hashIndex + 1) : "");
                openDoc(path, content);
              } else {
                await revealItemInDir(path);
              }
            })
            .catch((reason) =>
              window.alert(t("openFileFailed", { error: String(reason) }))
            );
        };
        anchor.addEventListener("click", handleClick);
        cleanups.push(() => anchor.removeEventListener("click", handleClick));
      }

      await hydrateMermaid(currentRoot);
    }

    void enhance().catch((reason) => {
      if (!cancelled) setError(String(reason));
    });
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [html, doc?.id, doc?.path, openDoc, setPendingAnchor]);

  if (!doc) {
    return <div className="preview empty">{t("openToPreview")}</div>;
  }

  if (error) {
    return <div className="preview-scroll empty">{t("previewFailed", { error })}</div>;
  }

  return (
    <div ref={scrollRef} className="preview-scroll" onScroll={onScroll}>
      <article
        ref={articleRef}
        className="markdown-body"
        aria-label={t("previewOf", { name: doc.name })}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

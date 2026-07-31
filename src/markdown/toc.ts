import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import type { Heading, RootContent } from "mdast";

export interface TocItem {
  id: string;
  level: number;
  line: number;
  text: string;
}

const parser = unified().use(remarkParse).use(remarkMath);
export const HEADING_ID_PREFIX = "user-content-";

function nodeText(node: RootContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("alt" in node && typeof node.alt === "string") return node.alt;
  return "children" in node ? node.children.map(nodeText).join("") : "";
}

export function uniqueHeadingId(
  text: string,
  used: Map<string, number>,
  fallback: string
): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || fallback;
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count}` : base;
}

export function headingAnchorIds(fragment: string): string[] {
  let id = fragment.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    return [];
  }
  if (!id) return [];
  return id.startsWith(HEADING_ID_PREFIX) ? [id] : [id, `${HEADING_ID_PREFIX}${id}`];
}

export function getMarkdownToc(source: string): TocItem[] {
  const used = new Map<string, number>();
  const items: TocItem[] = [];
  visit(parser.parse(source), "heading", (node: Heading) => {
    const text = node.children.map(nodeText).join("").trim();
    const line = Math.max(0, (node.position?.start.line ?? 1) - 1);
    if (text) {
      items.push({
        id: uniqueHeadingId(text, used, `heading-${line + 1}`),
        level: node.depth,
        line,
        text,
      });
    }
  });
  return items;
}

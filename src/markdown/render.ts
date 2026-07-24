import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import rehypeStringify from "rehype-stringify";
import rehypeShiki from "@shikijs/rehype";
import type { BuiltinLanguage } from "shiki";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";
import { remarkMermaid } from "./mermaid.ts";
import { BG_COLORS, TEXT_COLORS } from "./colors.ts";
import { HEADING_ID_PREFIX, uniqueHeadingId } from "./toc.ts";

const textClasses = TEXT_COLORS.map((color) => `wr-text-${color.label}`);
const backgroundClasses = BG_COLORS.map((color) => `wr-bg-${color.label}`);
const safeColorClass = new Map([
  ...TEXT_COLORS.map((color) => [`color:${color.value}`, `wr-text-${color.label}`] as const),
  ...BG_COLORS.map((color) => [`background:${color.value}`, `wr-bg-${color.label}`] as const),
]);

function elementText(node: Element): string {
  return node.children
    .map((child) =>
      child.type === "text" ? child.value : child.type === "element" ? elementText(child) : ""
    )
    .join("");
}

function rehypeSafeColors() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "span" && node.tagName !== "mark") return;
      const style = typeof node.properties.style === "string" ? node.properties.style : "";
      const match = style.match(
        /^\s*(color|background(?:-color)?)\s*:\s*(#[0-9a-f]{6})\s*;?\s*$/i
      );
      if (!match) return;
      const property = match[1].toLowerCase().startsWith("background") ? "background" : "color";
      const className = safeColorClass.get(`${property}:${match[2].toLowerCase()}`);
      if (className) node.properties.className = [className];
    });
  };
}

function rehypeHeadingIds() {
  return (tree: Root) => {
    const used = new Map<string, number>();
    let index = 0;
    visit(tree, "element", (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      node.properties.id = uniqueHeadingId(elementText(node), used, `heading-${++index}`);
    });
  };
}

const schema: Schema = {
  ...defaultSchema,
  clobberPrefix: HEADING_ID_PREFIX,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    span: [["className", ...textClasses] as [string, ...string[]]],
    mark: [["className", ...backgroundClasses] as [string, ...string[]]],
    pre: [
      ...(defaultSchema.attributes?.pre ?? []),
      ["className", "mermaid"] as [string, ...string[]],
      "dataMermaid",
    ],
  },
};

// Limited set — loading all ~200 langs freezes WebView on first open.
const SHIKI_LANGS: BuiltinLanguage[] = [
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "html",
  "css",
  "scss",
  "python",
  "bash",
  "shellscript",
  "markdown",
  "yaml",
  "toml",
  "rust",
  "sql",
  "xml",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
];

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkMermaid)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSafeColors)
  .use(rehypeHeadingIds)
  .use(rehypeSanitize, schema)
  // KaTeX must run before Shiki: display math surfaces as <pre><code class="math-display">
  // and Shiki would otherwise consume it as a code block.
  .use(rehypeKatex)
  .use(rehypeShiki, {
    theme: "github-light",
    langs: SHIKI_LANGS,
    fallbackLanguage: "plaintext",
  })
  .use(rehypeStringify);

export async function renderMarkdown(source: string): Promise<string> {
  return String(await processor.process(source));
}

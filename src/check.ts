import { renderMarkdown } from "./markdown/render.ts";
import { getMarkdownToc, headingAnchorIds } from "./markdown/toc.ts";
import { applyColor, stripColorTags } from "./markdown/colors.ts";
import { useDocStore } from "./store/docStore.ts";
import { decodeFileContent, parentPath } from "./tauri/api.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const store = useDocStore.getState();
store.openDoc("C:\\docs\\one.md", "saved");
store.openDoc("C:\\docs\\nested\\two.md", "two");
store.updateDoc("C:\\docs\\one.md", "changed");
store.markClean("C:\\docs\\one.md", "saved");
assert(useDocStore.getState().docs[0].dirty, "A stale save must not clear newer edits.");

store.replacePath("C:\\docs", "D:\\notes");
assert(
  useDocStore.getState().docs.every((doc) => doc.path.startsWith("D:\\notes")),
  "Renaming a folder must update every open descendant."
);

store.removePath("D:\\notes\\nested");
assert(useDocStore.getState().docs.length === 1, "Deleting a folder must close its open files.");

const html = await renderMarkdown(
  "# Working\n\n<script>alert(1)</script>\n\n$x^2$\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst ok = true\n```"
);
assert(
  html.includes('<h1 id="user-content-working">Working</h1>'),
  "Markdown headings must render with anchor IDs."
);
assert(!html.includes("<script"), "Dangerous HTML must be removed.");
assert(html.includes("<table>"), "GFM tables must render.");
assert(html.includes("katex"), "Math must render.");
assert(html.includes("shiki") || html.includes("<pre>"), "Code blocks must be highlighted.");
assert(
  headingAnchorIds("#working").includes("user-content-working"),
  "Preview anchors must account for sanitized heading IDs."
);

assert(
  decodeFileContent(new TextEncoder().encode("# 标题").buffer) === "# 标题",
  "File content buffers must decode as UTF-8 text."
);
assert(parentPath("C:\\README.md") === "C:\\", "Windows drive-root documents must keep their root.");
assert(parentPath("/README.md") === "/", "Unix root documents must keep their root.");

const toc = getMarkdownToc("# A\n\n```md\n# Not heading\n```\n\n## B");
assert(toc.length === 2 && toc[0].text === "A" && toc[1].text === "B", "TOC must read markdown headings.");
const setextToc = getMarkdownToc("Title\n=====\n\n````md\n```\n# Not heading\n````");
assert(
  setextToc.length === 1 && setextToc[0].text === "Title",
  "TOC must use Markdown parsing for Setext headings and fence lengths."
);

// Color tags survive the render pipeline.
const colored = await renderMarkdown(
  'a <span style="color: #d73a49">red</span> <mark style="background: #fff3b0">hi</mark>'
);
assert(colored.includes('class="wr-text-red"'), "safe text colors must become classes.");
assert(colored.includes('class="wr-bg-yellow"'), "safe background colors must become classes.");
const unsafeStyle = await renderMarkdown(
  '<span style="position: fixed; inset: 0">cover</span>'
);
assert(!unsafeStyle.includes("position"), "arbitrary inline styles must be removed.");
assert(colored.includes('id="user-content-') === false, "plain colored text must not gain heading IDs.");

// applyColor wraps the selection with the requested tag.
const w1 = applyColor("hello world", 6, 11, "text", "#d73a49");
assert(
  w1.text === 'hello <span style="color: #d73a49">world</span>',
  `wrap text color: ${w1.text}`
);

// Last pick wins: re-coloring replaces, never nests.
const w2 = applyColor(w1.text, w1.selStart, w1.selEnd, "bg", "#fff3b0");
assert(
  w2.text === 'hello <mark style="background: #fff3b0">world</mark>',
  `recolor replaces, got: ${w2.text}`
);

// Clear strips tags without adding new ones.
const w3 = applyColor(w2.text, w2.selStart, w2.selEnd, null, null);
assert(w3.text === "hello world", `clear strips, got: ${w3.text}`);

// Partial overlap: selecting across an existing tag removes that tag entirely.
const src = 'a <span style="color: red">bc</span> de';
const start = src.indexOf("b");
const end = src.indexOf("e") + 1;
const stripped = stripColorTags(src, start, end);
assert(stripped.text === "a bc de", `partial overlap strips tag, got: ${stripped.text}`);

// Untouched color tags outside the selection survive.
const mixed = 'x <span style="color: red">y</span> z <span style="color: blue">w</span>';
const i0 = mixed.indexOf("z");
const kept = stripColorTags(mixed, i0, i0 + 1);
assert(
  kept.text === mixed,
  `tags outside selection must be preserved, got: ${kept.text}`
);

// Mermaid code fences become placeholders the client hydrates.
const mmd = await renderMarkdown("```mermaid\ngraph LR\n  A --> B\n```");
assert(
  mmd.includes('<pre class="mermaid"'),
  `mermaid fence must become placeholder, got: ${mmd}`
);
assert(
  mmd.includes("data-mermaid="),
  `mermaid placeholder must carry the encoded source, got: ${mmd}`
);

// Preview split: opening doc B after doc A shows B in a single pane.
const store2 = useDocStore.getState();
store2.setRoot("/tmp/x", []);
store2.openDoc("/tmp/x/a.md", "a");
store2.openDoc("/tmp/x/b.md", "b");
{
  const { previewPanes, focusedPane } = useDocStore.getState();
  assert(
    previewPanes.length === 1 && previewPanes[0].activeTabId === "/tmp/x/b.md",
    `single preview shows latest, got ${JSON.stringify(previewPanes)}`
  );
  assert(focusedPane === 0, `focus on single pane, got ${focusedPane}`);
}

// Splitting moves the doc into a right pane and focuses it.
store2.splitPreview("/tmp/x/a.md");
{
  const { previewPanes, focusedPane } = useDocStore.getState();
  assert(
    previewPanes.length === 2 &&
      previewPanes[0].activeTabId === "/tmp/x/b.md" &&
      previewPanes[1].activeTabId === "/tmp/x/a.md",
    `split puts new doc on right, got ${JSON.stringify(previewPanes)}`
  );
  assert(focusedPane === 1, `split focuses right pane, got ${focusedPane}`);
}

// Per-pane tabs: each pane keeps its own tab list and active tab.
store2.openDoc("/tmp/x/c.md", "c");
{
  const { previewPanes } = useDocStore.getState();
  assert(
    previewPanes[1].tabs.join(",") === "/tmp/x/a.md,/tmp/x/c.md" &&
      previewPanes[1].activeTabId === "/tmp/x/c.md" &&
      previewPanes[0].activeTabId === "/tmp/x/b.md",
    `new doc opens in focused pane, got ${JSON.stringify(previewPanes)}`
  );
}
store2.setPaneActiveTab(0, "/tmp/x/b.md");
assert(
  useDocStore.getState().focusedPane === 0,
  "activating a tab in a pane focuses that pane"
);

// Unsplit merges right tabs into the left pane without duplicates.
store2.unsplitPreview();
{
  const { previewPanes, focusedPane } = useDocStore.getState();
  assert(
    previewPanes.length === 1 &&
      previewPanes[0].tabs.join(",") === "/tmp/x/b.md,/tmp/x/a.md,/tmp/x/c.md",
    `unsplit merges tabs, got ${JSON.stringify(previewPanes)}`
  );
  assert(focusedPane === 0, `unsplit focuses single pane, got ${focusedPane}`);
}

// Dragging supports exact placement, keeps empty split targets, and reorders in place.
store2.splitPreview("/tmp/x/c.md");
store2.moveTabToPane("/tmp/x/b.md", 0, 1, 1);
store2.moveTabToPane("/tmp/x/a.md", 0, 1, 0);
{
  const { previewPanes, focusedPane, activeId } = useDocStore.getState();
  assert(
    previewPanes.length === 2 &&
      previewPanes[0].tabs.length === 0 &&
      previewPanes[1].tabs.join(",") === "/tmp/x/a.md,/tmp/x/c.md,/tmp/x/b.md",
    `cross-pane move must preserve the split and insertion point, got ${JSON.stringify(previewPanes)}`
  );
  assert(
    focusedPane === 1 && activeId === "/tmp/x/a.md",
    "cross-pane move must focus and activate the moved tab"
  );
}
store2.moveTabToPane("/tmp/x/b.md", 1, 0, 0);
store2.moveTabToPane("/tmp/x/c.md", 1, 1, 0);
assert(
  useDocStore.getState().previewPanes[1].tabs.join(",") === "/tmp/x/c.md,/tmp/x/a.md",
  `same-pane move must reorder tabs, got ${JSON.stringify(useDocStore.getState().previewPanes)}`
);
store2.unsplitPreview();

// Closing a doc removes it from every pane; closing the active tab picks a neighbor.
store2.splitPreview("/tmp/x/c.md");
store2.closeDoc("/tmp/x/c.md");
{
  const { docs, previewPanes, focusedPane } = useDocStore.getState();
  assert(
    !docs.some((doc) => doc.id === "/tmp/x/c.md") &&
      previewPanes.length === 2 &&
      !previewPanes.some((pane) => pane.tabs.includes("/tmp/x/c.md")) &&
      previewPanes[1].tabs.length === 0,
    `closing a preview tab must close the document without collapsing the split, got ${JSON.stringify(previewPanes)}`
  );
  assert(focusedPane === 1, "closing a tab must not steal focus from its pane");
}
store2.closeDoc("/tmp/x/a.md");
assert(
  !useDocStore.getState().previewPanes.some((p) => p.tabs.includes("/tmp/x/a.md")),
  `closing a doc removes it from preview panes, got ${JSON.stringify(useDocStore.getState().previewPanes)}`
);

// Regression: focusing a pane must NOT steal the sidebar's active-file highlight.
// Clicking an empty pane, then opening a file into it, must not make the other
// pane "lose" its file or appear stuck.
{
  useDocStore.getState().setRoot("/tmp/z", []);
  const s = useDocStore.getState();
  s.openDoc("/tmp/z/a.md", "a");
  s.splitPreview("/tmp/z/a.md"); // left empty, right = a
  s.setFocusedPane(0); // click the empty left pane
  assert(
    useDocStore.getState().focusedPane === 0 &&
      useDocStore.getState().activeId === "/tmp/z/a.md",
    "focusing an empty pane must not change the active file highlight"
  );
  s.openDoc("/tmp/z/b.md", "b"); // sidebar: open b into the focused (left) pane
  const st = useDocStore.getState();
  assert(
    st.previewPanes[0].activeTabId === "/tmp/z/b.md" &&
      st.previewPanes[1].activeTabId === "/tmp/z/a.md" &&
      st.focusedPane === 0,
    `file must open in the focused pane, got ${JSON.stringify(st.previewPanes)}`
  );
  // The right pane can still receive a different file after being focused.
  s.setFocusedPane(1);
  s.openDoc("/tmp/z/c.md", "c");
  const st2 = useDocStore.getState();
  assert(
    st2.previewPanes[1].activeTabId === "/tmp/z/c.md" &&
      st2.previewPanes[0].activeTabId === "/tmp/z/b.md",
    `each pane switches files independently, got ${JSON.stringify(st2.previewPanes)}`
  );
}

// Clean documents reload from disk; dirty documents keep unsaved edits.
{
  useDocStore.getState().setRoot("/tmp/reload", []);
  const s = useDocStore.getState();
  s.openDoc("/tmp/reload/a.md", "v1");
  s.openDoc("/tmp/reload/a.md", "v2");
  assert(useDocStore.getState().docs[0].content === "v2", "Clean documents must reload.");
  s.updateDoc("/tmp/reload/a.md", "unsaved");
  s.openDoc("/tmp/reload/a.md", "v3");
  assert(
    useDocStore.getState().docs[0].content === "unsaved",
    "Dirty documents must not be overwritten by reopening."
  );
  s.reloadDoc("/tmp/reload/a.md", "v4");
  assert(
    useDocStore.getState().docs[0].content === "unsaved",
    "Refreshing must not overwrite unsaved edits."
  );
  s.markClean("/tmp/reload/a.md", "unsaved");
  s.reloadDoc("/tmp/reload/a.md", "v5");
  assert(
    useDocStore.getState().docs[0].content === "v5",
    "Refreshing must update clean documents without reopening tabs."
  );
}

// Lazy tree loading updates only the requested directory.
{
  useDocStore.getState().setRoot("/tmp/tree", [
    { name: "a", path: "/tmp/tree/a", isDirectory: true },
    { name: "b", path: "/tmp/tree/b", isDirectory: true },
  ]);
  useDocStore.getState().setTreeChildren("/tmp/tree/a", [
    { name: "x.md", path: "/tmp/tree/a/x.md", isDirectory: false },
  ]);
  const [a, b] = useDocStore.getState().tree;
  assert(a.children?.[0].name === "x.md" && b.children === undefined, "Tree loading must be local.");
}

console.log("Checks passed.");

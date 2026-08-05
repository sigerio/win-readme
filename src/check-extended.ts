// Extended logic checks mirroring UI paths that check.ts doesn't cover.
import { useDocStore } from "./store/docStore.ts";
import { renderMarkdown } from "./markdown/render.ts";
import { getMarkdownToc } from "./markdown/toc.ts";
import { applyColor } from "./markdown/colors.ts";
import { headingAnchorIds } from "./markdown/toc.ts";
import { rememberWorkspace } from "./workspaceHistory.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  rememberWorkspace(["/a", "/b", "/c", "/d", "/e"], "/c").join(",") ===
    "/c,/a,/b,/d,/e",
  "workspace history must move reopened paths to the front and keep five entries"
);

const store = () => useDocStore.getState();

// ─── store: setActive routes to focused pane, finds existing tab in any pane ─
{
  store().setRoot("/tmp/a", []);
  store().addRoot("/tmp/b", [{ name: "README.md", path: "/tmp/b/README.md", isDirectory: false }]);
  assert(
    store().workspaceRoots.map((root) => root.path).join(",") === "/tmp/a,/tmp/b" &&
      store().rootPath === "/tmp/b",
    "opening a second folder must append it and make it active"
  );
  store().removeRoot("/tmp/b");
  assert(
    store().workspaceRoots.length === 1 && store().rootPath === "/tmp/a",
    "closing a folder must leave the other workspace open"
  );
  store().openDoc("/tmp/a/x.md", "x");
  store().openDoc("/tmp/a/y.md", "y");
  store().splitPreview("/tmp/a/x.md"); // left: [y], right: [x], focused=1
  store().setFocusedPane(0);
  store().setActive("/tmp/a/x.md"); // x is open in right pane
  const st = store();
  assert(
    st.focusedPane === 1 && st.previewPanes[1].activeTabId === "/tmp/a/x.md",
    `setActive must jump to the pane that already has the doc, got focus=${st.focusedPane}`
  );
}

// ─── store: markClean with stale content does NOT clear dirty ─
{
  store().openDoc("/tmp/a/z.md", "v1");
  store().updateDoc("/tmp/a/z.md", "v2");
  store().markClean("/tmp/a/z.md", "v1"); // stale save result arrives after newer edit
  const doc = store().docs.find((d) => d.id === "/tmp/a/z.md")!;
  assert(doc.dirty && doc.content === "v2", "stale markClean must not clear dirty or content");
  store().markClean("/tmp/a/z.md", "v2");
  assert(!store().docs.find((d) => d.id === "/tmp/a/z.md")!.dirty, "matching markClean clears dirty");
}

// ─── store: closeDoc activates neighbor tab in same pane ─
{
  store().setRoot("/tmp/b", []);
  store().openDoc("/tmp/b/1.md", "1");
  store().openDoc("/tmp/b/2.md", "2");
  store().openDoc("/tmp/b/3.md", "3");
  store().closeDoc("/tmp/b/2.md");
  const st = store();
  assert(
    st.previewPanes[0].tabs.join(",") === "/tmp/b/1.md,/tmp/b/3.md" &&
      st.previewPanes[0].activeTabId === "/tmp/b/3.md",
    `closing middle tab must activate the right neighbor, got ${JSON.stringify(st.previewPanes)}`
  );
  store().closeDoc("/tmp/b/3.md");
  assert(
    store().previewPanes[0].activeTabId === "/tmp/b/1.md",
    "closing last tab must activate remaining"
  );
}

// ─── store: moveTabToPane into empty pane keeps split, toIndex clamps ─
{
  store().setRoot("/tmp/c", []);
  store().openDoc("/tmp/c/a.md", "a");
  store().openDoc("/tmp/c/b.md", "b");
  store().splitPreview("/tmp/c/a.md");
  store().moveTabToPane("/tmp/c/b.md", 0, 1, 99); // oversized index
  const st = store();
  assert(
    st.previewPanes.length === 2 &&
      st.previewPanes[1].tabs.join(",") === "/tmp/c/a.md,/tmp/c/b.md" &&
      st.previewPanes[0].tabs.length === 0,
    `oversized toIndex must clamp, got ${JSON.stringify(st.previewPanes)}`
  );
}

// ─── store: replacePath updates pendingAnchor docId too ─
{
  store().setPendingAnchor("/tmp/c/a.md", "frag");
  store().replacePath("/tmp/c", "/tmp/d");
  const st = store();
  assert(st.pendingAnchor?.docId === "/tmp/d/a.md", "pendingAnchor docId must be remapped");
  assert(st.activeId === "/tmp/d/b.md", `activeId must remap, got ${st.activeId}`);
}

// ─── render: heading anchor slug matches TOC slug (non-ASCII + duplicates) ─
{
  const src = "# 标题 A\n\n## 标题 A\n\n# Title!";
  const html = await renderMarkdown(src);
  const toc = getMarkdownToc(src);
  assert(toc.length === 3, `expected 3 headings, got ${toc.length}`);
  for (const item of toc) {
    const ids = headingAnchorIds(item.id);
    const found = ids.some((id) => html.includes(`id="${id}"`));
    assert(found, `TOC id ${item.id} not found in rendered HTML: ${html}`);
  }
}

// ─── TOC: display math must not be parsed as a Setext heading ─
{
  const src = "# Clarke\n\n$$\n\\begin{bmatrix}\ni_\\alpha\\\\\\ni_\\beta\n\\end{bmatrix}\n$$\n\n## Park";
  const toc = getMarkdownToc(src);
  assert(
    toc.map((item) => item.text).join("|") === "Clarke|Park",
    `display math leaked into TOC: ${JSON.stringify(toc)}`
  );
}

// ─── render: link hrefs survive sanitize (relative .md links must stay clickable) ─
{
  const html = await renderMarkdown("[other](./other.md#section) and [ext](https://example.com)");
  assert(html.includes('href="./other.md#section"'), `relative link lost: ${html}`);
  assert(html.includes('href="https://example.com"'), `external link lost: ${html}`);
}

// ─── render: image src survives for Preview's asset rewrite ─
{
  const html = await renderMarkdown("![pic](images/pic.png)");
  assert(html.includes('src="images/pic.png"'), `img src lost: ${html}`);
}

// ─── render: task list checkboxes render ─
{
  const html = await renderMarkdown("- [x] done\n- [ ] todo");
  assert(html.includes('type="checkbox"') || html.includes("checkbox"), `task list lost: ${html}`);
}

// ─── colors: applyColor over text containing an unmatched closing tag ─
{
  // stray </span> without open — pairs logic must not crash or drop text
  const src = "a </span> bc";
  const out = applyColor(src, 0, src.length, "text", "#d73a49");
  assert(out.text.includes("bc"), `stray close tag must not eat text: ${out.text}`);
}

// ─── colors: nested different-kind tags both stripped on re-color ─
{
  const inner = applyColor("hello world", 6, 11, "text", "#d73a49");
  const outer = applyColor(inner.text, 0, inner.text.length, "bg", "#fff3b0");
  // re-coloring whole thing: inner span intersects selection so it must be stripped
  assert(
    !outer.text.includes("<span") && outer.text.includes("<mark"),
    `re-color must strip inner span, got: ${outer.text}`
  );
}

console.log("Extended checks passed.");

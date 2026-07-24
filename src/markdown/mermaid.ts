import { visit } from "unist-util-visit";
import type { Root } from "mdast";

// Swap mermaid code fences for a placeholder the client hydrates into SVG.
// The raw text must survive sanitization, so we encode it for the trip through
// the HTML pipeline and decode it client-side.
export function remarkMermaid() {
  return (tree: Root) => {
    visit(tree, "code", (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.lang !== "mermaid") return;
      const encoded = encodeURIComponent(node.value);
      parent.children[index] = {
        type: "html",
        value: `<pre class="mermaid" data-mermaid="${encoded}"></pre>`,
      };
    });
  };
}

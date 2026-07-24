import type { Mermaid } from "mermaid";

let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Replace every <pre class="mermaid"> placeholder with the rendered SVG.
// On failure, the placeholder is swapped for an error block + the source.
export async function hydrateMermaid(root: HTMLElement): Promise<void> {
  const placeholders = Array.from(
    root.querySelectorAll<HTMLPreElement>("pre.mermaid[data-mermaid]")
  );
  if (!placeholders.length) return;
  const mermaid = await loadMermaid();

  await Promise.all(
    placeholders.map(async (el, i) => {
      const source = decodeURIComponent(el.dataset.mermaid ?? "");
      try {
        const { svg } = await mermaid.render(`mermaid-${Date.now()}-${i}`, source);
        const wrapper = document.createElement("figure");
        wrapper.className = "mermaid-figure";
        wrapper.innerHTML = svg;
        el.replaceWith(wrapper);
      } catch (error) {
        const wrapper = document.createElement("div");
        wrapper.className = "mermaid-error";
        const message = document.createElement("div");
        message.className = "mermaid-error-message";
        message.textContent = error instanceof Error ? error.message : String(error);
        const pre = document.createElement("pre");
        pre.textContent = source;
        wrapper.append(message, pre);
        el.replaceWith(wrapper);
      }
    })
  );
}

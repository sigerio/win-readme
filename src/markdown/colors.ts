export interface ColorSpec {
  label: string;
  value: string;
}

// Curated to stay readable on the white preview background.
export const TEXT_COLORS: ColorSpec[] = [
  { label: "red", value: "#d73a49" },
  { label: "orange", value: "#e36209" },
  { label: "green", value: "#22863a" },
  { label: "blue", value: "#0366d6" },
  { label: "purple", value: "#6f42c1" },
  { label: "gray", value: "#6a737d" },
];

export const BG_COLORS: ColorSpec[] = [
  { label: "yellow", value: "#fff3b0" },
  { label: "green", value: "#c8f7c5" },
  { label: "blue", value: "#cfe8ff" },
  { label: "pink", value: "#ffd6e7" },
];

const TAG_RE = /<(span|mark) style="(?:color|background): [^"]+">|<\/(span|mark)>/g;

interface TagPair {
  openStart: number;
  openEnd: number;
  closeStart: number;
  closeEnd: number;
}

// Match each color open tag with its close tag.
function colorTagPairs(text: string): TagPair[] {
  const pairs: TagPair[] = [];
  const stack: { tag: string; openStart: number; openEnd: number }[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text))) {
    if (m[1]) {
      stack.push({ tag: m[1], openStart: m.index, openEnd: m.index + m[0].length });
    } else if (m[2]) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === m[2]) {
          pairs.push({
            openStart: stack[i].openStart,
            openEnd: stack[i].openEnd,
            closeStart: m.index,
            closeEnd: m.index + m[0].length,
          });
          stack.splice(i, 1);
          break;
        }
      }
    }
  }
  return pairs;
}

// Remove color tags whose [open,close) range intersects [selStart, selEnd).
// Selection indexes are remapped to the stripped text.
export function stripColorTags(
  text: string,
  selStart: number,
  selEnd: number
): { text: string; selStart: number; selEnd: number } {
  const drops: { start: number; end: number }[] = [];
  for (const p of colorTagPairs(text)) {
    if (p.openStart < selEnd && p.closeEnd > selStart) {
      drops.push({ start: p.openStart, end: p.openEnd });
      drops.push({ start: p.closeStart, end: p.closeEnd });
    }
  }
  if (!drops.length) return { text, selStart, selEnd };
  drops.sort((a, b) => a.start - b.start);

  const removedBefore = (pos: number) =>
    drops.reduce((n, d) => (d.end <= pos ? n + (d.end - d.start) : n), 0);

  let out = "";
  let last = 0;
  for (const d of drops) {
    out += text.slice(last, d.start);
    last = d.end;
  }
  out += text.slice(last);

  return {
    text: out,
    selStart: selStart - removedBefore(selStart),
    selEnd: selEnd - removedBefore(selEnd),
  };
}

// Strip color tags intersecting the selection, then wrap the selection in the
// requested color. Last pick wins — no nesting, no residue. kind=null strips only.
export function applyColor(
  text: string,
  selStart: number,
  selEnd: number,
  kind: "text" | "bg" | null,
  color: string | null
): { text: string; selStart: number; selEnd: number } {
  const stripped = stripColorTags(text, selStart, selEnd);
  if (!kind || !color) return stripped;
  const open =
    kind === "text"
      ? `<span style="color: ${color}">`
      : `<mark style="background: ${color}">`;
  const close = kind === "text" ? "</span>" : "</mark>";
  const next =
    stripped.text.slice(0, stripped.selStart) +
    open +
    stripped.text.slice(stripped.selStart, stripped.selEnd) +
    close +
    stripped.text.slice(stripped.selEnd);
  return {
    text: next,
    selStart: stripped.selStart,
    selEnd: stripped.selEnd + open.length + close.length,
  };
}

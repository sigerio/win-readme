import { open } from "@tauri-apps/plugin-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  readDir,
  readTextFile,
  writeTextFile,
  mkdir,
  remove,
  rename,
} from "@tauri-apps/plugin-fs";
import type { FolderEntry } from "../store/docStore";
import { collator } from "../i18n.ts";

export function joinPath(base: string, name: string): string {
  const separator = base.lastIndexOf("\\") > base.lastIndexOf("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index === 0) return path[0];
  if (index === 2 && /^[a-z]:[\\/]/i.test(path)) return path.slice(0, 3);
  return index < 0 ? "" : path.slice(0, index);
}

export async function pickFolder(): Promise<string | null> {
  const path = await open({ directory: true, recursive: true });
  return typeof path === "string" ? path : null;
}

export async function pickMarkdownFile(): Promise<string | null> {
  const path = await open({
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  return typeof path === "string" ? path : null;
}

export function decodeFileContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
  if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content);
  return String(content ?? "");
}

export async function openFile(path: string): Promise<string> {
  if (isTauri()) await invoke("scope_document", { path });
  return decodeFileContent(await (readTextFile as (path: string) => Promise<unknown>)(path));
}
export const saveFile = writeTextFile;
export const createFile = (path: string) => writeTextFile(path, "", { createNew: true });
export const createFolder = mkdir;
export const removeFile = remove;
export const removeFolder = (path: string) => remove(path, { recursive: true });
export const movePath = rename;

// Recursive scan of these freezes the UI on common project roots.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
]);

export async function loadDirectory(path: string): Promise<FolderEntry[]> {
  const result = (await readDir(path))
    .filter((entry) => !SKIP_DIRS.has(entry.name.toLowerCase()))
    .map((entry): FolderEntry => ({
      name: entry.name,
      path: joinPath(path, entry.name),
      isDirectory: entry.isDirectory,
    }));

  return result.sort((a, b) => {
    if (a.isDirectory === b.isDirectory) {
      return collator.compare(a.name, b.name);
    }
    return a.isDirectory ? -1 : 1;
  });
}

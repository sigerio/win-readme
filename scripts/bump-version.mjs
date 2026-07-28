#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
const cargoTomlPath = resolve(root, files[0]);
const cargoLockPath = resolve(root, files[1]);
const cargoTomlVersion = /(\[package\][\s\S]*?^version\s*=\s*")([^"]+)(")/m;
const cargoLockVersion = /(\[\[package\]\]\r?\nname = "win-readme"\r?\nversion = ")([^"]+)(")/;
const args = new Set(process.argv.slice(2));
const preCommit = args.has("--pre-commit");
const dryRun = args.has("--dry-run");

function versionFrom(text, pattern, label) {
  const version = pattern.exec(text)?.[2];
  if (!version) throw new Error(`Could not find ${label} version`);
  return version;
}

function nextPatch(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Expected a stable semantic version, got ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function withVersion(text, pattern, version, label) {
  if (!pattern.test(text)) throw new Error(`Could not find ${label} version`);
  return text.replace(pattern, `$1${version}$3`);
}

function gitText(spec) {
  try {
    return execFileSync("git", ["show", spec], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function assertNoUnstagedVersionChanges() {
  const result = spawnSync("git", ["diff", "--quiet", "--no-ext-diff", "--", ...files], {
    cwd: root,
  });
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(`Stage or stash unstaged version-file changes first:\n${files.join("\n")}`);
  }
  throw result.error ?? new Error(String(result.stderr));
}

function main() {
  for (const arg of args) {
    if (arg !== "--pre-commit" && arg !== "--dry-run") throw new Error(`Unknown option: ${arg}`);
  }
  if (preCommit) assertNoUnstagedVersionChanges();

  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const cargoLock = readFileSync(cargoLockPath, "utf8");
  const currentVersion = versionFrom(cargoToml, cargoTomlVersion, "Cargo.toml package");
  const stagedCargoToml = preCommit ? gitText(":src-tauri/Cargo.toml") : cargoToml;
  if (!stagedCargoToml) throw new Error("Could not read staged Cargo.toml");
  const stagedVersion = versionFrom(stagedCargoToml, cargoTomlVersion, "staged Cargo.toml package");
  const headCargoToml = preCommit ? gitText("HEAD:src-tauri/Cargo.toml") : null;
  const headVersion = headCargoToml
    ? versionFrom(headCargoToml, cargoTomlVersion, "HEAD Cargo.toml package")
    : null;
  const version = preCommit
    ? headVersion && stagedVersion === headVersion
      ? nextPatch(headVersion)
      : stagedVersion
    : nextPatch(currentVersion);
  const nextCargoToml = withVersion(cargoToml, cargoTomlVersion, version, "Cargo.toml package");
  const nextCargoLock = withVersion(cargoLock, cargoLockVersion, version, "Cargo.lock win-readme");

  if (!dryRun) {
    if (cargoToml !== nextCargoToml) writeFileSync(cargoTomlPath, nextCargoToml);
    if (cargoLock !== nextCargoLock) writeFileSync(cargoLockPath, nextCargoLock);
    if (preCommit) execFileSync("git", ["add", "--", ...files], { cwd: root });
  }

  console.log(`${dryRun ? "Next version" : "Version"}: ${currentVersion} -> ${version}`);
}

try {
  main();
} catch (error) {
  console.error(`Version bump failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

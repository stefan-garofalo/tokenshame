#!/usr/bin/env node
/// <reference types="node" />
/**
 * Hook Activation (HI Commit Gate): sets `core.hooksPath` to `.githooks`, where the Managed Hook Script lives.
 * Changes nothing while another hook path is set, another hook manager owns `.git/hooks/pre-commit`, or installed
 * lefthook is older than 2.1.14 (older versions force-install their own hook over it). Prints why it changed
 * nothing and exits 0, so a `prepare` script never fails on it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const hooksPath = ".githooks";
const minimum = [2, 1, 14];

/** @param {string[]} args - Git arguments. @returns {string} Trimmed stdout. */
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/** @param {string[]} args - Git arguments; a non-zero exit means "absent". @returns {string} Output or "". */
const gitOrEmpty = (...args) => {
  try {
    return git(...args);
  } catch {
    return "";
  }
};

/** @param {string} root - Checkout root. @returns {string} Installed lefthook version, or "" when absent. */
const installedLefthook = (root) => {
  /** @type {unknown} */
  let manifest;
  try {
    manifest = JSON.parse(
      readFileSync(path.join(root, "node_modules", "lefthook", "package.json"), "utf-8"),
    );
  } catch {
    manifest = {};
  }
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "";
};

/** @param {string} version - Semver. @returns {boolean} Whether it is at least `minimum`. */
const isSupported = (version) => {
  const parts = version.split(/[.+-]/u, 3).map(Number);
  for (const [index, floor] of minimum.entries()) {
    const part = parts[index] ?? 0;
    if (part !== floor) {
      return part > floor;
    }
  }
  return true;
};

/**
 * Whether `lefthook install` generated the hook: its template defines `call_lefthook`. `hi commit-gate verify`
 * applies the same rule; a commit-gate test holds both to the same fixtures.
 * @param {string} hook - Hook script content. @returns {boolean} Whether lefthook generated it.
 */
const isLefthookHook = (hook) => hook.includes("call_lefthook");

/** @returns {string} The default-path pre-commit hook when another hook manager owns it, else "". */
const otherManagerHook = () => {
  const hook = gitOrEmpty("rev-parse", "--git-path", "hooks/pre-commit");
  try {
    return isLefthookHook(readFileSync(hook, "utf-8")) ? "" : hook;
  } catch {
    return "";
  }
};

/** @returns {string} What the run did, or why it changed nothing. */
const activate = () => {
  const root = gitOrEmpty("rev-parse", "--show-toplevel");
  if (root === "") {
    return "not inside a Git checkout; nothing changed";
  }
  const current = gitOrEmpty("config", "--get", "core.hooksPath");
  if (current === hooksPath) {
    return `core.hooksPath is already ${hooksPath}`;
  }
  if (current !== "") {
    return `core.hooksPath is ${current}; HI never overrides another hook path, so nothing changed`;
  }
  const otherHook = otherManagerHook();
  if (otherHook !== "") {
    return `${otherHook} is not a lefthook hook; another hook manager owns pre-commit, so HI leaves core.hooksPath unset (migrate that hook, then rerun this script)`;
  }
  const version = installedLefthook(root);
  if (version === "") {
    return "lefthook is not installed; run the package install, then rerun this script";
  }
  if (!isSupported(version)) {
    return `lefthook ${version} is older than ${minimum.join(".")}; nothing changed`;
  }
  git("config", "core.hooksPath", hooksPath);
  return `set core.hooksPath to ${hooksPath}`;
};

console.log(`Hook Activation: ${activate()}.`);

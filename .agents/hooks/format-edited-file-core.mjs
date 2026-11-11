// Helpers of the edited-file hook, kept out of format-edited-file.mjs because OpenCode
// loads every export of that plugin module as a plugin function.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export function contentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}

function formatLintFinding(diagnostic) {
  const location =
    Number.isInteger(diagnostic.line) && Number.isInteger(diagnostic.column)
      ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`
      : diagnostic.file;
  const severity = diagnostic.severity ? ` (${diagnostic.severity})` : "";
  const rule = diagnostic.rule ? ` [${diagnostic.rule}]` : "";
  const help = diagnostic.help ? ` Help: ${diagnostic.help}` : "";
  const documentation = diagnostic.documentation ? ` Docs: ${diagnostic.documentation}` : "";
  return `${location}${severity}${rule} ${diagnostic.message}${help}${documentation}`;
}

export function providerFeedbackMessage(summary) {
  const findings = summary.diagnostics.map(formatLintFinding);
  const failures = summary.failures.map(
    (failure) => `${failure.file ? `${failure.file}: ` : ""}${failure.message}`,
  );
  const formatFailures = summary.format_failed.map((file) => `${file}: formatting failed`);
  const lines = [...findings, ...formatFailures, ...failures];
  if (summary.exhausted) {
    return [
      "Lint repair exhausted after three unchanged attempts. Continue without another automatic repair request.",
      ...lines,
    ].join("\n");
  }
  return ["Lint feedback after edit. Fix these findings before continuing:", ...lines].join("\n");
}

export function renderProviderFeedback(provider, summary) {
  const hasFeedback =
    summary.diagnostics.length > 0 ||
    summary.failures.length > 0 ||
    summary.format_failed.length > 0;
  if (!hasFeedback) {
    return null;
  }

  const message = providerFeedbackMessage(summary);
  switch (provider) {
    case "codex":
      return {
        ...(summary.exhausted ? {} : { decision: "block", reason: message }),
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: message,
        },
        systemMessage: message,
      };
    case "claude":
      return {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: message,
        },
      };
    case "cursor":
      return { user_message: message };
    case "opencode":
      return {
        event: "lint-feedback",
        status: summary.exhausted ? "exhausted" : summary.status,
        diagnostics: summary.diagnostics,
        failures: summary.failures,
        repairRequested: !summary.exhausted,
      };
    default:
      throw new Error(`Unsupported lint feedback provider: ${provider}`);
  }
}

export function codexStateFilePath(root, sessionId) {
  const repositoryIdentity = contentHash(realpathSync.native(root));
  const safeSessionId = sessionId.replaceAll("/", "_");
  const stateDir = path.join(os.tmpdir(), "codex-hooks", repositoryIdentity, safeSessionId);
  mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, "format-state.json");
}

const mirrorSkippedNames = new Set([
  ".git",
  ".turbo",
  ".next",
  "coverage",
  "dist",
  "build",
  "__pycache__",
]);
const mirrorSkippedPaths =
  /^(?:\.devpunks\/(?:delivery|cache|replaced-scaffold)|\.devpunks-cache)(?:\/|$)/u;

function isOutside(relativeTarget) {
  return (
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  );
}

const lintMirrorOwner = /^hi-lint-mirror-(?<pid>\d+)-/u;
// Mirrors named before #257 (`hi-lint-mirror-XXXXXX`, from `mkdtemp`) carry no owner PID.
const pidlessLintMirror = /^hi-lint-mirror-[A-Za-z0-9]{6}$/u;
// Far above the 30 s agent hook timeout; guards an owner in another PID namespace that shares the directory.
const abandonedLintMirrorAgeMs = 10 * 60 * 1000;
// Without an owner to check, only age proves a pid-less mirror abandoned, so its floor is higher.
const abandonedPidlessLintMirrorAgeMs = 60 * 60 * 1000;

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** How old a mirror must be to count as abandoned, or `undefined` when it is live or not a mirror. */
function abandonedMirrorAgeMs(name) {
  const owner = lintMirrorOwner.exec(name)?.groups?.pid;
  if (owner !== undefined) {
    return isProcessAlive(Number(owner)) ? undefined : abandonedLintMirrorAgeMs;
  }
  return pidlessLintMirror.test(name) ? abandonedPidlessLintMirrorAgeMs : undefined;
}

// A harness kills a hook run that exceeds its timeout, so that run's `finally` never removes
// its mirror. Each mirror name carries its owner PID; later runs remove mirrors of dead owners.
export function createLintMirror() {
  const directory = os.tmpdir();
  for (const name of readdirSync(directory)) {
    const minimumAgeMs = abandonedMirrorAgeMs(name);
    if (minimumAgeMs === undefined) {
      continue;
    }
    const mirror = path.join(directory, name);
    try {
      const stat = lstatSync(mirror);
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > minimumAgeMs) {
        rmSync(mirror, { force: true, recursive: true });
      }
    } catch {
      // A concurrent hook run can remove the same mirror first; the sweep must not block the edit.
    }
  }
  return mkdtempSync(path.join(directory, `hi-lint-mirror-${process.pid}-`));
}

function isMirrorSkipped(root, from) {
  const relative = path.relative(root, from).split(path.sep).join("/");
  return mirrorSkippedNames.has(path.basename(from)) || mirrorSkippedPaths.test(relative);
}

// Adds each directory under `directory` whose whole subtree the walk below would copy file by
// file unchanged: no skipped entry, `node_modules`, symlink, or non-regular file.
function collectCloneable(root, directory, cloneable) {
  let clean = true;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const from = path.join(directory, entry.name);
    if (isMirrorSkipped(root, from) || entry.name === "node_modules") {
      clean = false;
    } else if (entry.isDirectory()) {
      clean = collectCloneable(root, from, cloneable) && clean;
    } else if (!entry.isFile()) {
      clean = false;
    }
  }
  if (clean) {
    cloneable.add(directory);
  }
  return clean;
}

// Node's copyFileSync does not clone on macOS (#257), but `cp -c` does, at no disk cost.
// A failed clone (a volume that is not APFS) leaves no partial copy, and the walk copies instead.
function cloneDirectory(from, to) {
  if (spawnSync("cp", ["-c", "-R", from, to], { stdio: "ignore" }).status === 0) {
    return true;
  }
  rmSync(to, { force: true, recursive: true });
  return false;
}

// Mirrors the repository for isolated lint parity. Required inputs must resolve inside the
// physical root; unrelated external symlinks are skipped instead of failing the edit.
export function copyLintMirror(root, mirror, requiredInputs) {
  const physicalRoot = realpathSync(root);
  for (const input of requiredInputs) {
    const source = path.join(root, input);
    if (existsSync(source) && isOutside(path.relative(physicalRoot, realpathSync(source)))) {
      throw new Error(`Cannot prove temporary lint parity for external repository input: ${input}`);
    }
  }
  const cloneable = new Set();
  if (process.platform === "darwin") {
    collectCloneable(root, root, cloneable);
  }
  const visit = (source, destination) => {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name);
      if (isMirrorSkipped(root, from)) {
        continue;
      }
      const to = path.join(destination, entry.name);
      if (entry.name === "node_modules") {
        symlinkSync(realpathSync(from), to, "dir");
      } else if (entry.isSymbolicLink()) {
        const relativeTarget = path.relative(physicalRoot, realpathSync(from));
        if (!isOutside(relativeTarget)) {
          const link = readlinkSync(from);
          symlinkSync(path.isAbsolute(link) ? path.resolve(mirror, relativeTarget) : link, to);
        }
      } else if (entry.isDirectory() && cloneable.has(from)) {
        if (!cloneDirectory(from, to)) {
          // A clone fails for the whole volume (not APFS, or not the mirror's volume): stop trying.
          cloneable.clear();
          visit(from, to);
        }
      } else if (entry.isDirectory()) {
        visit(from, to);
      } else if (entry.isFile()) {
        // A copy-on-write clone (btrfs, XFS) takes no time or space; other file systems copy.
        copyFileSync(from, to, constants.COPYFILE_FICLONE);
      } else {
        throw new Error(`Cannot mirror non-regular repository input: ${path.relative(root, from)}`);
      }
    }
  };
  visit(root, mirror);
}

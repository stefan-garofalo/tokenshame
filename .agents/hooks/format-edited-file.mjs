#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
// Helpers live in a sibling module: OpenCode loads every export of this plugin module as a plugin.
import {
  codexStateFilePath,
  contentHash,
  copyLintMirror,
  createLintMirror,
  providerFeedbackMessage,
  renderProviderFeedback,
} from "./format-edited-file-core.mjs";

const javascriptFormattableSuffixes = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);
const javascriptLintableSuffixes = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const pythonFormattableSuffixes = new Set([".py"]);
const formattableSuffixes = new Set([
  ...javascriptFormattableSuffixes,
  ...pythonFormattableSuffixes,
]);
const ignoredParts = new Set([".git", "node_modules", ".next", "dist"]);
const installedRecordPath = ".devpunks/installed.json";
// Copied and Built Artifacts are Baseline-owned; Authored Artifacts belong to the repository.
const protectedArtifacts = new Set(["copied", "built"]);
const productRoots = new Set(["apps", "packages"]);
const backendWorkspaceSegments = new Set(["api", "backend", "server", "services"]);

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  return result.status === 0 ? result.stdout : null;
}

function repoRoot(cwd) {
  return runGit(["rev-parse", "--show-toplevel"], cwd)?.trim() ?? "";
}

function normalizeRelativePath(root, filePath, managedPaths, caseInsensitivePaths) {
  if (!filePath) {
    return null;
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  const relativePath = path.relative(root, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  let canonicalRelativePath;
  try {
    canonicalRelativePath = path.relative(
      realpathSync.native(root),
      realpathSync.native(absolutePath),
    );
    if (
      !canonicalRelativePath ||
      canonicalRelativePath.startsWith("..") ||
      path.isAbsolute(canonicalRelativePath)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const normalizedPath = relativePath.split(path.sep).join("/");
  const canonicalNormalizedPath = canonicalRelativePath.split(path.sep).join("/");
  if (
    managedPathKey(normalizedPath, caseInsensitivePaths) !==
    managedPathKey(canonicalNormalizedPath, caseInsensitivePaths)
  ) {
    return null;
  }
  const extension = path.extname(normalizedPath);

  if (!formattableSuffixes.has(extension)) {
    return null;
  }

  if (normalizedPath.split("/").some((part) => ignoredParts.has(part))) {
    return null;
  }

  const normalizedPathKey = managedPathKey(normalizedPath, caseInsensitivePaths);
  if (
    normalizedPathKey === managedPathKey(installedRecordPath, caseInsensitivePaths) ||
    managedPaths.has(normalizedPathKey)
  ) {
    return null;
  }

  if (!existsSync(path.join(root, normalizedPath))) {
    return null;
  }

  return normalizedPath;
}

function alternateCasePath(filePath) {
  const basename = path.basename(filePath);
  const alternateBasename =
    basename === basename.toUpperCase() ? basename.toLowerCase() : basename.toUpperCase();
  return path.join(path.dirname(filePath), alternateBasename);
}

function pathCaseSemantics(root) {
  const canonicalProbe = path.join(root, path.dirname(installedRecordPath));
  const alternateProbe = alternateCasePath(canonicalProbe);
  try {
    return realpathSync.native(alternateProbe) === realpathSync.native(canonicalProbe)
      ? "case-insensitive"
      : "case-sensitive";
  } catch (error) {
    return error && typeof error === "object" && error.code === "ENOENT"
      ? "case-sensitive"
      : "unknown";
  }
}

function managedPathKey(filePath, caseInsensitivePaths) {
  return caseInsensitivePaths ? filePath.toLowerCase() : filePath;
}

function isLintablePath(relativePath) {
  const parts = relativePath.split("/");
  return (
    parts.length > 0 &&
    productRoots.has(parts[0]) &&
    javascriptLintableSuffixes.has(path.extname(relativePath))
  );
}

function isPythonPath(relativePath) {
  return pythonFormattableSuffixes.has(path.extname(relativePath));
}

function runCommand(root, args, stdio = ["ignore", "pipe", "pipe"]) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: root,
    stdio,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function workspaceRelativePath(workspace, root, relativePath) {
  const workspacePath = path.relative(workspace, path.join(root, relativePath));
  return workspacePath.split(path.sep).join("/");
}

function toolCommand(directory, tool, args) {
  const root = repoRoot(directory);
  let current = directory;
  while (true) {
    const manifest = path.join(current, "node_modules", tool, "package.json");
    if (existsSync(manifest)) {
      const value = JSON.parse(readFileSync(manifest, "utf8"));
      const bin = typeof value.bin === "string" ? value.bin : value.bin?.[tool];
      if (value.name !== tool || typeof bin !== "string" || path.isAbsolute(bin) || bin.split(/[\\/]/u).includes("..")) throw new Error(`Invalid repository-local ${tool} executable`);
      return [path.resolve(path.dirname(manifest), bin), ...args];
    }
    if (current === root || path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  // An intentionally missing local path becomes a normal operational failure in runCommand.
  return [path.join(root || directory, "node_modules/.bin", tool), ...args];
}

function nearestPythonProject(root, relativePath) {
  const parts = relativePath.split("/");

  for (let index = parts.length - 1; index > 0; index -= 1) {
    const projectPath = parts.slice(0, index).join("/");
    if (existsSync(path.join(root, projectPath, "pyproject.toml"))) {
      return projectPath;
    }
  }

  if (parts.length >= 2 && productRoots.has(parts[0]) && backendWorkspaceSegments.has(parts[1])) {
    return `${parts[0]}/${parts[1]}`;
  }

  return ".";
}

function formatCommandForPath(root, relativePath) {
  if (isPythonPath(relativePath)) {
    return [
      "uv",
      "run",
      "--project",
      nearestPythonProject(root, relativePath),
      "ruff",
      "format",
      "--stdin-filename",
      relativePath,
      "-",
    ];
  }

  return toolCommand(root, "oxfmt", ["--stdin-filepath", relativePath]);
}

function lintCommandForPath(root, relativePath, workspaceRelative = false) {
  if (isPythonPath(relativePath)) {
    return [
      "uv",
      "run",
      "--project",
      nearestPythonProject(root, relativePath),
      "ruff",
      "check",
      "--fix",
      "--stdin-filename",
      relativePath,
      "-",
    ];
  }

  if (!workspaceRelative && !isLintablePath(relativePath)) {
    return null;
  }
  if (workspaceRelative && !javascriptLintableSuffixes.has(path.extname(relativePath))) {
    return null;
  }

  return toolCommand(root, "oxlint", [relativePath]);
}

function normalizeManagedPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    return null;
  }

  const posixPath = filePath.replaceAll("\\", "/");
  if (path.posix.isAbsolute(posixPath) || path.win32.parse(filePath).root !== "") {
    return null;
  }

  const normalizedPath = path.posix.normalize(posixPath);
  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    return null;
  }

  return normalizedPath;
}

// A missing or invalid Installed Record means nothing is managed; it never blocks an edit.
function loadManagedPaths(root, caseInsensitivePaths) {
  const record = loadJson(path.join(root, installedRecordPath));
  const paths = record?.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    return new Set();
  }

  const managedPaths = new Set();
  for (const [filePath, entry] of Object.entries(paths)) {
    const normalizedPath = normalizeManagedPath(filePath);
    if (!normalizedPath || typeof entry?.artifact !== "string") {
      return new Set();
    }
    if (protectedArtifacts.has(entry.artifact)) {
      managedPaths.add(managedPathKey(normalizedPath, caseInsensitivePaths));
    }
  }

  return managedPaths;
}

function readDescriptor(descriptor) {
  const size = fstatSync(descriptor).size;
  const content = Buffer.alloc(size);
  let offset = 0;

  while (offset < size) {
    const bytesRead = readSync(descriptor, content, offset, size - offset, offset);
    if (bytesRead === 0) {
      throw new Error("Edited file changed while reading");
    }
    offset += bytesRead;
  }

  return content;
}

function sameRegularFile(filePath, opened) {
  try {
    const current = lstatSync(filePath);
    return (
      current.isFile() &&
      current.nlink === 1 &&
      current.dev === opened.dev &&
      current.ino === opened.ino
    );
  } catch {
    return false;
  }
}

function openFormattingTarget(filePath, expectedFingerprint) {
  let descriptor;
  try {
    const before = lstatSync(filePath);
    if (!before.isFile() || before.nlink !== 1) {
      return null;
    }

    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || !sameRegularFile(filePath, opened)) {
      closeSync(descriptor);
      return null;
    }

    const content = readDescriptor(descriptor);
    const fingerprint = contentHash(content);
    if (typeof expectedFingerprint === "string" && fingerprint !== expectedFingerprint) {
      closeSync(descriptor);
      return null;
    }

    return { content, descriptor, fingerprint, opened };
  } catch {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    return null;
  }
}

function runTransformCommand(root, command, content) {
  const [executable, ...args] = command;
  const result = spawnSync(executable, args, {
    cwd: root,
    input: content,
    maxBuffer: Math.max(16 * 1024 * 1024, content.length * 4),
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "buffer",
  });

  return {
    ok: result.status === 0,
    status: result.status,
    error: result.error,
    stderr: result.stderr?.toString() ?? "",
    output: result.error === undefined && Buffer.isBuffer(result.stdout) ? result.stdout : content,
  };
}

function lintDiagnosticRule(code) {
  if (typeof code !== "string") {
    return "";
  }

  const match = code.match(/\(([^()]+)\)$/);
  return match?.[1] ?? code;
}

function normalizeDiagnostic(diagnostic, root, fallbackPath, temporaryPath = null) {
  if (!diagnostic || typeof diagnostic !== "object") {
    return null;
  }

  let file = typeof diagnostic.filename === "string" ? diagnostic.filename : fallbackPath;
  if (temporaryPath && file === temporaryPath) {
    file = fallbackPath;
  }
  const normalizedFile = normalizeEditedPath(file, root) ?? fallbackPath;
  const label = Array.isArray(diagnostic.labels) ? diagnostic.labels[0] : null;
  const span = label?.span && typeof label.span === "object" ? label.span : {};
  const normalized = {
    file: normalizedFile,
    rule: lintDiagnosticRule(diagnostic.code),
    severity: typeof diagnostic.severity === "string" ? diagnostic.severity : "error",
    line: Number.isInteger(span.line) ? span.line : null,
    column: Number.isInteger(span.column) ? span.column : null,
    message: typeof diagnostic.message === "string" ? diagnostic.message : "Lint finding",
  };

  if (typeof diagnostic.help === "string" && diagnostic.help.length > 0) {
    normalized.help = diagnostic.help;
  }
  if (typeof diagnostic.url === "string" && diagnostic.url.length > 0) {
    normalized.documentation = diagnostic.url;
  }
  if (Number.isInteger(span.offset)) normalized.offset = span.offset;
  if (Number.isInteger(span.length)) normalized.length = span.length;
  return normalized;
}

function normalizeManagedDiagnostics(report, root, scope, fallbackPath) {
  if (!Array.isArray(report)) return {ok: false, error: "Oxlint did not return validated diagnostics"};
  const diagnostics = [];
  for (const diagnostic of report) {
    let filename = fallbackPath;
    if (typeof diagnostic.filename === "string" && diagnostic.filename.length > 0) {
      filename = path.relative(root, path.resolve(root, scope, diagnostic.filename)).split(path.sep).join("/");
      if (filename === ".." || filename.startsWith("../") || path.isAbsolute(filename)) return {ok: false, error: "Oxlint diagnostic escaped the managed repository"};
    }
    diagnostics.push(normalizeDiagnostic({...diagnostic, filename}, root, fallbackPath));
  }
  return {ok: true, diagnostics};
}

async function lintRuntime(root) {
  const canonical = path.join(root, ".agents/scripts/managed-lint-runner.mjs");
  const local = new URL("../scripts/managed-lint-runner.mjs", import.meta.url);
  const runner = await import(existsSync(canonical) ? pathToFileURL(canonical).href : local.href);
  const resolver = await import(existsSync(canonical) ? pathToFileURL(path.join(root, ".agents/scripts/managed-lint.mjs")).href : new URL("../scripts/managed-lint.mjs", import.meta.url).href);
  return { ...runner, ...resolver };
}

async function selectedLint(root, filePaths) {
  try {
    const runtime = await lintRuntime(root);
    const paths = filePaths.map((file) => path.relative(root, path.resolve(root, file)).split(path.sep).join("/"));
    const resolution = await runtime.loadManagedLint(root, paths);
    if (resolution.status === "disabled") return { runtime, routes: [] };
    if (resolution.status !== "ready") throw new Error(resolution.diagnostics.join("\n"));
    return { runtime, routes: resolution.routes };
  } catch (error) {
    return { failure: emptyLintSummary("operational_failure", [{ stage: "config-load", command: "managed lint selection", message: error.message }]) };
  }
}

// Python shares quality exclusions, but does not require JavaScript owner selection.
function qualityExclusions(root) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(path.join(root, ".devpunks/settings.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(settings) || (settings.lint !== undefined && !record(settings.lint))) {
    throw new TypeError("Managed quality settings and lint must be objects");
  }
  const exclude = settings.lint?.exclude;
  if (exclude === undefined) return [];
  if (!Array.isArray(exclude) || !exclude.every((pattern) =>
    typeof pattern === "string" && pattern.length > 0 && !pattern.startsWith("!") &&
    !pattern.includes("\\") && !path.posix.isAbsolute(pattern) &&
    pattern.split("/").every((part) => part !== ".." && part !== "") &&
    path.posix.normalize(pattern) === pattern
  )) throw new TypeError("lint.exclude must be a list of repository-relative patterns.");
  return exclude;
}

async function selectedQuality(root, filePaths) {
  const caseSemantics = pathCaseSemantics(root);
  if (caseSemantics === "unknown") {
    return {failure: emptyLintSummary("operational_failure", [
      {
        stage: "config-load",
        command: "path case semantics",
        message: "Unable to determine path case semantics",
      },
    ])};
  }

  const caseInsensitivePaths = caseSemantics === "case-insensitive";
  const managedPaths = loadManagedPaths(root, caseInsensitivePaths);

  try {
    const runtime = await lintRuntime(root);
    const exclude = qualityExclusions(root);
    const eligible = [...new Set(filePaths.map((file) =>
      normalizeRelativePath(root, file, managedPaths, caseInsensitivePaths)
    ).filter((file) => file !== null && !runtime.isManagedQualityPathExcluded({path: file, exclude})))];
    const nonPythonPaths = filePaths.filter((file) => !isPythonPath(file));
    const selection = nonPythonPaths.length > 0
      ? await selectedLint(root, nonPythonPaths)
      : {runtime, routes: []};
    // Keep raw resolver-owned dependency triggers, including scaffold metadata.
    // The resolver handles excluded-only source; unrelated non-JS files stay independent.
    const requiresSelection = nonPythonPaths.some((file) =>
      javascriptFormattableSuffixes.has(path.extname(file))
    );
    const javascriptPaths = selection.failure && !requiresSelection
      ? [] : nonPythonPaths;
    const routes = selection.routes ?? [];
    const selectedFiles = new Set(routes.flatMap((route) => route.files));
    return {
      runtime, routes, javascriptPaths,
      files: eligible.filter((file) => isPythonPath(file) || selectedFiles.has(file)),
      failures: javascriptPaths.length > 0 ? selection.failure?.failures ?? [] : [],
    };
  } catch (error) {
    return {failure: emptyLintSummary("operational_failure", [{stage: "config-load", command: "managed quality exclusions", message: error.message}])};
  }
}

async function runSafeJavascriptLint(workspace, root, relativePath, content, route, runtime) {
  const mirror = createLintMirror();
  let command;
  try {
    copyLintMirror(root, mirror, [relativePath, route.config, ...route.inputs]);
    for (const input of [route.config, ...route.inputs]) {
      if (existsSync(path.join(root, input)) && !existsSync(path.join(mirror, input))) throw new Error(`Required lint input is excluded from safe mirror: ${input}`);
    }
    const target = path.join(mirror, relativePath);
    if (!lstatSync(target).isFile()) throw new Error("Temporary lint target must be a copied regular file");
    writeFileSync(target, content);
    const options = {root: mirror, route, output: "json", logicalSourcePath: relativePath, physicalInputPath: target};
    command = await runtime.buildManagedLintCommand({...options, fix: true});
    if (command.status !== "ready") throw new Error(command.diagnostics.join("\n"));
    const fixed = runtime.executeManagedLintCommand({root: mirror, command});
    if (fixed.code === 2) throw new Error(["Oxlint fix failed", fixed.stdout, fixed.stderr].filter(Boolean).join("\n"));
    const fixedDiagnostics = normalizeManagedDiagnostics(fixed.diagnostics, mirror, route.scope, relativePath);
    if (!fixedDiagnostics.ok) throw new Error(fixedDiagnostics.error);
    command = await runtime.buildManagedLintCommand(options);
    if (command.status !== "ready") throw new Error(command.diagnostics.join("\n"));
    const result = runtime.executeManagedLintCommand({root: mirror, command});
    if (result.code === 2) throw new Error(["Oxlint verification failed", result.stdout, result.stderr].filter(Boolean).join("\n"));
    const parsed = normalizeManagedDiagnostics(result.diagnostics, mirror, route.scope, relativePath);
    if (!parsed.ok) throw new Error(parsed.error);
    return {ok: true, content: readFileSync(target), diagnostics: parsed.diagnostics};
  } catch (error) {
    return {ok: false, stage: "lint-verify", command: command ? commandText([command.executable, ...command.args]) : "managed lint mirror", error: error.message};
  } finally { rmSync(mirror, {force: true, recursive: true}); }
}

const publicationWorkerScript = `
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";

const request = JSON.parse(process.argv[1]);
const content = readFileSync(0);
let claimIdentity;
let claimPath = request.claim;
let originalDescriptor;
let publishedDescriptor;
let publishedIdentity;
let stageDescriptor;
let stageIdentity;
let stagePath = request.stage;

const assertParentIdentity = () => {
  const current = statSync(".");
  if (current.dev !== request.parent.device || current.ino !== request.parent.inode) {
    throw new Error("Formatting parent identity changed");
  }
};
const sameRegularFile = (filePath, expected) => {
  const current = lstatSync(filePath, { throwIfNoEntry: false });
  return (
    current !== undefined &&
    current.isFile() &&
    current.nlink === 1 &&
    current.dev === expected.device &&
    current.ino === expected.inode
  );
};
const descriptorHash = (descriptor) => {
  const size = fstatSync(descriptor).size;
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = readSync(descriptor, buffer, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error("Formatting target changed while reading");
    offset += bytesRead;
  }
  return createHash("sha256").update(buffer).digest("hex");
};
const closeDescriptors = () => {
  if (publishedDescriptor !== undefined) closeSync(publishedDescriptor);
  if (originalDescriptor !== undefined) closeSync(originalDescriptor);
  if (stageDescriptor !== undefined) closeSync(stageDescriptor);
  publishedDescriptor = undefined;
  originalDescriptor = undefined;
  stageDescriptor = undefined;
};

try {
  assertParentIdentity();
  stageDescriptor = openSync(
    stagePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    request.targetIdentity.mode,
  );
  const staged = fstatSync(stageDescriptor);
  if (!staged.isFile() || staged.nlink !== 1) throw new Error("Formatting stage is unsafe");
  stageIdentity = { device: staged.dev, inode: staged.ino };
  let offset = 0;
  while (offset < content.length) {
    offset += writeSync(stageDescriptor, content, offset, content.length - offset, offset);
  }
  fchmodSync(stageDescriptor, request.targetIdentity.mode & 0o7777);
  fsyncSync(stageDescriptor);
  closeSync(stageDescriptor);
  stageDescriptor = undefined;
  assertParentIdentity();

  originalDescriptor = openSync(
    request.target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const original = fstatSync(originalDescriptor);
  if (
    !original.isFile() ||
    original.nlink !== 1 ||
    original.dev !== request.targetIdentity.device ||
    original.ino !== request.targetIdentity.inode ||
    descriptorHash(originalDescriptor) !== request.fingerprint ||
    !sameRegularFile(request.target, request.targetIdentity)
  ) {
    throw new Error("Formatting target changed before publication");
  }

  if (lstatSync(claimPath, { throwIfNoEntry: false }) !== undefined) {
    throw new Error("Formatting claim path already exists");
  }
  claimIdentity = request.targetIdentity;
  renameSync(request.target, claimPath);
  const claimed = lstatSync(claimPath);
  claimIdentity = { device: claimed.dev, inode: claimed.ino };
  if (
    !sameRegularFile(claimPath, request.targetIdentity) ||
    descriptorHash(originalDescriptor) !== request.fingerprint ||
    lstatSync(request.target, { throwIfNoEntry: false }) !== undefined
  ) {
    throw new Error("Formatting target changed while being claimed");
  }
  assertParentIdentity();

  linkSync(stagePath, request.target);
  publishedIdentity = stageIdentity;
  unlinkSync(stagePath);
  stagePath = undefined;
  stageIdentity = undefined;
  publishedDescriptor = openSync(
    request.target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  const published = fstatSync(publishedDescriptor);
  if (
    !sameRegularFile(claimPath, request.targetIdentity) ||
    descriptorHash(originalDescriptor) !== request.fingerprint ||
    !published.isFile() ||
    published.nlink !== 1 ||
    published.dev !== publishedIdentity.device ||
    published.ino !== publishedIdentity.inode ||
    descriptorHash(publishedDescriptor) !== request.outputFingerprint ||
    !sameRegularFile(request.target, publishedIdentity)
  ) {
    throw new Error("Formatting target changed across publication");
  }
  assertParentIdentity();

  closeDescriptors();
  unlinkSync(claimPath);
  claimPath = undefined;
  claimIdentity = undefined;
  publishedIdentity = undefined;
} catch (error) {
  closeDescriptors();
  if (claimIdentity !== undefined && claimPath !== undefined) {
    try {
      const claim = lstatSync(claimPath, { throwIfNoEntry: false });
      if (
        claim !== undefined &&
        claim.dev === claimIdentity.device &&
        claim.ino === claimIdentity.inode &&
        claim.isFile() &&
        lstatSync(request.target, { throwIfNoEntry: false }) === undefined
      ) {
        linkSync(claimPath, request.target);
        unlinkSync(claimPath);
        claimPath = undefined;
      }
    } catch {
      // Retain the exact claim when it cannot be restored without replacement.
    }
  }
  if (stageIdentity !== undefined && stagePath !== undefined) {
    try {
      const stage = lstatSync(stagePath, { throwIfNoEntry: false });
      if (
        stage !== undefined &&
        stage.dev === stageIdentity.device &&
        stage.ino === stageIdentity.inode
      ) {
        unlinkSync(stagePath);
        stagePath = undefined;
      }
    } catch {
      // A private-path collision is not producer-owned.
    }
  }
  process.exitCode = 1;
}
`;

function publishFormattedContent(filePath, target, content) {
  const directory = path.dirname(filePath);
  const parent = lstatSync(directory);
  if (!parent.isDirectory()) return false;
  const suffix = randomUUID();
  const request = {
    claim: `.hi-format-claim-${suffix}.tmp`,
    fingerprint: target.fingerprint,
    outputFingerprint: contentHash(content),
    parent: { device: parent.dev, inode: parent.ino },
    stage: `.hi-format-stage-${suffix}.tmp`,
    target: path.basename(filePath),
    targetIdentity: {
      device: target.opened.dev,
      inode: target.opened.ino,
      mode: target.opened.mode,
    },
  };
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", publicationWorkerScript, JSON.stringify(request)],
    { cwd: directory, input: content, stdio: ["pipe", "ignore", "ignore"] },
  );
  return result.error === undefined && result.status === 0;
}

function emptyLintSummary(result = "clean", failures = []) {
  const summary = {
    format_failed: [],
    formatted: [],
    lint_failed: [],
    diagnostics: [],
    failures,
    result,
    exhausted: false,
    status: result === "operational_failure" ? "operational-failure" : result,
    files: [],
  };
  if (result === "operational_failure" && failures[0]) {
    summary.stage = failures[0].stage ?? "lint-verify";
    summary.command = failures[0].command ?? "";
    if (Number.isInteger(failures[0].exitCode)) summary.exitCode = failures[0].exitCode;
    summary.message = failures[0].message ?? "Lint operation failed";
  }
  return summary;
}

function commandText(command) {
  return Array.isArray(command) ? command.join(" ") : String(command ?? "");
}

async function formatAndLintFiles(root, filePaths, expectedFingerprints = null) {
  const selection = await selectedQuality(root, filePaths);
  if (selection.failure) return selection.failure;
  const normalizedFiles = selection.files;

  const formatted = [];
  const formatFailed = [];
  const lintFailed = [];
  const diagnostics = [];
  const failures = [...selection.failures];

  for (const relativePath of normalizedFiles) {
    const expectedFingerprint = expectedFingerprints?.[relativePath];
    if (expectedFingerprints !== null && typeof expectedFingerprint !== "string") {
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    const target = openFormattingTarget(absolutePath, expectedFingerprint);
    if (target === null) {
      failures.push({
        kind: "race",
        stage: "lint-verify",
        file: relativePath,
        command: "open edited file",
        message: "Edited file changed before formatting",
      });
      continue;
    }

    const route = selection.routes.find((item) => item.files.includes(relativePath));
    const workspace = isPythonPath(relativePath) ? root : path.resolve(root, route.scope);
    const workspacePath = workspaceRelativePath(workspace, root, relativePath);
    let formatCommand;
    try { formatCommand = formatCommandForPath(workspace, workspacePath); }
    catch (error) {
      closeSync(target.descriptor);
      failures.push({kind: "format", stage: "format", file: relativePath, command: "local formatter", message: error.message});
      continue;
    }

    // Keep mutating tools off the live path; stage output before claiming the validated target.
    const formatResult = runTransformCommand(
      workspace,
      formatCommand,
      target.content,
    );

    if (!formatResult.ok) {
      closeSync(target.descriptor);
      formatFailed.push(relativePath);
      failures.push({
        kind: "format",
        stage: "format",
        file: relativePath,
        command: commandText(formatCommand),
        exitCode: formatResult.status,
        message: formatResult.error?.message ?? (formatResult.stderr || "Oxfmt failed"),
      });
      continue;
    }

    const lintCommand = isPythonPath(relativePath) ? lintCommandForPath(workspace, workspacePath, true) : javascriptLintableSuffixes.has(path.extname(relativePath)) ? ["managed lint"] : null;
    let formattedContent = formatResult.output;
    let lintResult = null;
    if (lintCommand !== null && isPythonPath(relativePath)) {
      lintResult = runTransformCommand(workspace, lintCommand, formattedContent);
      if (lintResult.ok) {
        formattedContent = lintResult.output;
      }
    } else if (lintCommand !== null) {
      lintResult = await runSafeJavascriptLint(workspace, root, relativePath, formattedContent, route, selection.runtime);
      if (lintResult.ok) {
        formattedContent = lintResult.content;
        diagnostics.push(...lintResult.diagnostics);
      }
    }

    if (lintResult !== null && !lintResult.ok) {
      closeSync(target.descriptor);
      failures.push({
        kind: "lint",
        stage: lintResult.stage ?? "lint-verify",
        file: relativePath,
        command: lintResult.command ?? commandText(lintCommand),
        ...(Number.isInteger(lintResult.exitCode) ? { exitCode: lintResult.exitCode } : {}),
        message: lintResult.error ?? lintResult.error?.message ?? (lintResult.stderr || "Oxlint failed"),
      });
      continue;
    }

    const published = publishFormattedContent(absolutePath, target, formattedContent);
    closeSync(target.descriptor);
    if (!published) {
      failures.push({
        kind: "publication",
        stage: "lint-verify",
        file: relativePath,
        command: "atomic publication",
        message: "Atomic publication failed",
      });
      continue;
    }

    formatted.push(relativePath);

    if (lintResult !== null && lintResult.diagnostics?.length > 0) {
      lintFailed.push(relativePath);
    }
  }

  if (selection.routes.some((route) => route.triggered)) {
    const verified = await verifyLintFiles(root, filePaths);
    const known = new Set(diagnostics.map((diagnostic) => JSON.stringify(diagnostic)));
    for (const diagnostic of verified.diagnostics) {
      if (!known.has(JSON.stringify(diagnostic))) diagnostics.push(diagnostic);
    }
    failures.push(...verified.failures);
    for (const file of verified.lint_failed) if (!lintFailed.includes(file)) lintFailed.push(file);
  }

  const result =
    failures.length > 0 ? "operational_failure" : diagnostics.length > 0 ? "findings" : "clean";
  return {
    format_failed: formatFailed,
    formatted,
    lint_failed: lintFailed,
    diagnostics,
    failures,
    result,
    exhausted: false,
    status: result === "operational_failure" ? "operational-failure" : result,
    files: result === "findings" ? [...new Set(diagnostics.map((diagnostic) => diagnostic.file))] : formatted,
    ...(diagnostics.length > 0 ? { fingerprint: contentHash(JSON.stringify(diagnostics)), attempt: 1 } : {}),
    ...(failures.length > 0
      ? {
          stage: failures[0].stage ?? "lint-verify",
          command: failures[0].command ?? "",
          ...(Number.isInteger(failures[0].exitCode) ? { exitCode: failures[0].exitCode } : {}),
          message: failures[0].message ?? "Lint operation failed",
        }
      : {}),
  };
}

function verifyPythonFile(root, relativePath) {
  const command = ["uv", "run", "--project", nearestPythonProject(root, relativePath), "ruff", "check", "--output-format", "json", "--stdin-filename", relativePath, "-"];
  const target = openFormattingTarget(path.join(root, relativePath));
  if (target === null) return {failure: {stage: "lint-verify", file: relativePath, command: commandText(command), message: "Edited file changed before verification"}};
  try {
    const result = runTransformCommand(root, command, target.content);
    if (result.error || ![0, 1].includes(result.status)) throw new Error(result.error?.message ?? (result.stderr || "Ruff verification failed"));
    const report = JSON.parse(result.output.toString());
    if (!Array.isArray(report) || report.some((item) => !item || typeof item.message !== "string" || typeof item.code !== "string" || !Number.isInteger(item.location?.row) || !Number.isInteger(item.location?.column))) throw new Error("Ruff returned invalid diagnostics");
    if (result.status !== 0 && report.length === 0) throw new Error(result.stderr || "Ruff failed without diagnostics");
    return {diagnostics: report.map((item) => ({file: relativePath, rule: item.code, severity: "error", line: item.location.row, column: item.location.column, message: item.message, ...(typeof item.url === "string" ? {documentation: item.url} : {})}))};
  } catch (error) {
    return {failure: {stage: "lint-verify", file: relativePath, command: commandText(command), message: error.message}};
  } finally { closeSync(target.descriptor); }
}

async function verifyLintFiles(root, filePaths) {
  const selection = await selectedQuality(root, filePaths);
  if (selection.failure) return selection.failure;
  const diagnostics = [];
  const failures = [...selection.failures];
  for (const file of selection.files.filter(isPythonPath)) {
    const verified = verifyPythonFile(root, file);
    if (verified.failure) failures.push(verified.failure);
    else diagnostics.push(...verified.diagnostics);
  }
  if (selection.javascriptPaths.length > 0 && selection.failures.length === 0) {
    const result = await selection.runtime.runManagedLint({root, paths: selection.javascriptPaths.map((file) => path.relative(root, path.resolve(root, file)).split(path.sep).join("/")), output: "json"});
    for (const owner of result.results ?? []) {
      const parsed = normalizeManagedDiagnostics(owner.diagnostics, root, owner.scope, "");
      if (parsed.ok) diagnostics.push(...parsed.diagnostics);
      else failures.push({stage: "lint-verify", command: "managed lint", message: parsed.error});
    }
    if (result.code === 2) failures.push({stage: "lint-verify", command: "managed lint", message: result.diagnostics?.join("\n") || result.results?.map((owner) => `${owner.stdout}\n${owner.stderr}`).join("\n") || "Lint verification failed without diagnostics"});
  }
  return {...emptyLintSummary(failures.length ? "operational_failure" : diagnostics.length ? "findings" : "clean", failures), diagnostics, lint_failed: [...new Set(diagnostics.map((diagnostic) => diagnostic.file))]};
}

function extractSingleFilePath(payload) {
  return (
    payload.filePath ??
    payload.file_path ??
    payload.tool_input?.filePath ??
    payload.tool_input?.file_path ??
    payload.tool_response?.filePath ??
    payload.tool_response?.file_path ??
    ""
  );
}

function emitProviderFeedback(provider, summary) {
  const feedback = renderProviderFeedback(provider, summary);
  if (feedback !== null) {
    process.stdout.write(JSON.stringify(feedback));
  }
}

async function runSingleFileMode(style) {
  const payload = readStdinJson();
  const root = repoRoot(process.cwd());

  if (!root) {
    return;
  }

  const filePath = extractSingleFilePath(payload);
  if (!filePath) {
    return;
  }

  const summary = await formatAndLintFiles(root, [filePath]);
  emitProviderFeedback(style, summary);
}

function dirtyFiles(root) {
  const output = runGit(["ls-files", "-m", "-o", "--exclude-standard"], root);
  if (!output) {
    return [];
  }

  return [
    ...new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((filePath) => !filePath.split("/").some((part) => ignoredParts.has(part))),
    ),
  ].sort();
}

function fileHash(filePath) {
  return contentHash(readFileSync(filePath));
}

function fingerprintPath(root, relativePath) {
  const normalizedPath = normalizeManagedPath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const absolutePath = path.join(root, normalizedPath);
  let rootRealPath;
  let fileRealPath;
  try {
    const stats = lstatSync(absolutePath);
    if (!stats.isFile()) {
      return null;
    }
    rootRealPath = realpathSync.native(root);
    fileRealPath = realpathSync.native(absolutePath);
  } catch {
    return null;
  }

  const relativeRealPath = path.relative(rootRealPath, fileRealPath);
  if (
    relativeRealPath === "" ||
    relativeRealPath.startsWith("..") ||
    path.isAbsolute(relativeRealPath)
  ) {
    return null;
  }

  return absolutePath;
}

function fingerprints(root) {
  const entries = {};

  for (const relativePath of dirtyFiles(root)) {
    const absolutePath = fingerprintPath(root, relativePath);
    if (absolutePath !== null) {
      entries[relativePath] = fileHash(absolutePath);
    }
  }

  return entries;
}

function loadJson(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isFingerprintRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readFingerprintRecord(value) {
  if (!isFingerprintRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([filePath, hash]) => typeof filePath === "string" && typeof hash === "string",
    ),
  );
}

function loadCodexState(filePath) {
  const raw = loadJson(filePath);
  return {
    baseline: readFingerprintRecord(raw?.baseline),
    diagnosticAttempts: isFingerprintRecord(raw?.diagnosticAttempts)
      ? raw.diagnosticAttempts
      : {},
    lastToolUseId: typeof raw?.lastToolUseId === "string" ? raw.lastToolUseId : "",
    processed: readFingerprintRecord(raw?.processed),
  };
}

function saveCodexState(filePath, state) {
  writeFileSync(
    filePath,
    JSON.stringify({
      baseline: state.baseline,
      diagnosticAttempts: state.diagnosticAttempts,
      lastToolUseId: state.lastToolUseId,
      processed: state.processed,
    }),
  );
}

function applyDiagnosticRetryLimit(state, summary) {
  const byFile = new Map();
  for (const diagnostic of summary.diagnostics) {
    const existing = byFile.get(diagnostic.file) ?? [];
    existing.push(diagnostic);
    byFile.set(diagnostic.file, existing);
  }

  let exhausted = false;
  let maximumAttempt = 0;
  for (const [relativePath, diagnostics] of byFile) {
    const fingerprint = contentHash(JSON.stringify(diagnostics));
    const previous = state.diagnosticAttempts[relativePath];
    const attempts =
      previous?.fingerprint === fingerprint && Number.isInteger(previous.attempts)
        ? Math.min(previous.attempts + 1, 3)
        : 1;
    state.diagnosticAttempts[relativePath] = { fingerprint, attempts };
    maximumAttempt = Math.max(maximumAttempt, attempts);
    if (attempts >= 3) {
      exhausted = true;
    }
  }

  for (const relativePath of Object.keys(state.diagnosticAttempts)) {
    if (!byFile.has(relativePath)) {
      delete state.diagnosticAttempts[relativePath];
    }
  }

  if (exhausted) {
    summary.exhausted = true;
    summary.result = "exhausted";
  }
  summary.status = "findings";
  summary.fingerprint = contentHash(JSON.stringify(summary.diagnostics));
  summary.attempt = maximumAttempt;
}

function updateProcessedFingerprints(root, state, filePaths) {
  for (const relativePath of filePaths) {
    const absolutePath = path.join(root, relativePath);

    if (existsSync(absolutePath)) {
      state.processed[relativePath] = fileHash(absolutePath);
      continue;
    }

    delete state.processed[relativePath];
  }
}

function pendingCodexFiles(state, current) {
  return Object.entries(current)
    .filter(
      ([relativePath, digest]) =>
        state.baseline[relativePath] !== digest && state.processed[relativePath] !== digest,
    )
    .map(([relativePath]) => relativePath);
}

function pruneProcessedFingerprints(state, current) {
  for (const relativePath of Object.keys(state.processed)) {
    if (current[relativePath] !== state.processed[relativePath]) {
      delete state.processed[relativePath];
    }
  }
}

async function runCodexSnapshotMode(mode) {
  const payload = readStdinJson();
  const cwd = String(payload.cwd ?? process.cwd());
  const sessionId = String(payload.session_id ?? "");
  const root = repoRoot(cwd);

  if (!root || !sessionId) {
    return;
  }

  const stateFile = codexStateFilePath(root, sessionId);

  if (mode === "session-start") {
    saveCodexState(stateFile, {
      baseline: fingerprints(root),
      diagnosticAttempts: {},
      lastToolUseId: "",
      processed: {},
    });
    return;
  }

  if (mode !== "post") {
    return;
  }

  const state = loadCodexState(stateFile);
  const toolUseId = typeof payload.tool_use_id === "string" ? payload.tool_use_id : "";

  if (toolUseId && state.lastToolUseId === toolUseId) {
    return;
  }

  const current = fingerprints(root);
  pruneProcessedFingerprints(state, current);
  const hasPatchCommand =
    payload.tool_name === "apply_patch" && typeof payload.tool_input?.command === "string";
  const patchedPaths = hasPatchCommand ? extractPatchedPaths(payload.tool_input.command, root) : [];
  const pending = pendingCodexFiles(state, current);
  const caseInsensitivePaths = pathCaseSemantics(root) === "case-insensitive";
  const pendingPaths = new Map(
    pending.map((relativePath) => [
      managedPathKey(relativePath, caseInsensitivePaths),
      relativePath,
    ]),
  );
  const touched = hasPatchCommand
    ? [
        ...new Set(
          patchedPaths
            .map((relativePath) =>
              pendingPaths.get(managedPathKey(relativePath, caseInsensitivePaths)),
            )
            .filter(Boolean),
        ),
      ]
    : pending;

  if (toolUseId) {
    state.lastToolUseId = toolUseId;
  }

  if (touched.length === 0) {
    saveCodexState(stateFile, state);
    return;
  }

  const summary = await formatAndLintFiles(root, touched, current);
  if (summary.diagnostics.length > 0) {
    applyDiagnosticRetryLimit(state, summary);
  } else {
    for (const relativePath of touched) {
      delete state.diagnosticAttempts[relativePath];
    }
  }
  updateProcessedFingerprints(root, state, summary.formatted);
  saveCodexState(stateFile, state);

  if (
    summary.diagnostics.length > 0 ||
    summary.failures.length > 0 ||
    summary.format_failed.length > 0
  ) {
    emitProviderFeedback("codex", summary);
  }
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeEditedPath(filePath, worktree) {
  if (!filePath) {
    return null;
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(worktree, filePath);
  const relativePath = path.relative(worktree, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return toPosixPath(relativePath);
}

function extractPatchedPaths(patchText, worktree) {
  if (!patchText) {
    return [];
  }

  const paths = [];

  for (const line of patchText.split("\n")) {
    let relativePath = null;

    if (line.startsWith("*** Add File: ")) {
      relativePath = line.slice("*** Add File: ".length).trim();
    } else if (line.startsWith("*** Update File: ")) {
      relativePath = line.slice("*** Update File: ".length).trim();
    } else if (line.startsWith("*** Move to: ")) {
      relativePath = line.slice("*** Move to: ".length).trim();
    }

    const normalizedPath = normalizeEditedPath(relativePath, worktree);
    if (normalizedPath) {
      paths.push(normalizedPath);
    }
  }

  return paths;
}

function editedPathsForTool(input, worktree) {
  const toolName = input?.tool;
  const args = input?.args ?? {};

  if (toolName === "apply_patch") {
    return extractPatchedPaths(args.patchText, worktree);
  }

  const filePath = args.filePath;
  const normalizedPath = normalizeEditedPath(filePath, worktree);
  return normalizedPath ? [normalizedPath] : [];
}

function parseSummary(stdout) {
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    return {};
  }
}

export const FormatAndLintPlugin = async ({ client, worktree }) => {
  return {
    "tool.execute.after": async (input) => {
      if (!["edit", "write", "multiedit", "apply_patch"].includes(input.tool)) {
        return;
      }

      const editedPaths = [...new Set(editedPathsForTool(input, worktree))].filter(Boolean);

      if (editedPaths.length === 0) {
        return;
      }

      const result = runCommand(
        worktree,
        ["node", ".agents/hooks/format-edited-file.mjs", "files", ...editedPaths],
        ["ignore", "pipe", "ignore"],
      );

      const parsedSummary = result.ok ? parseSummary(result.stdout) : {};
      const summary = {
        ...parsedSummary,
        status: typeof parsedSummary.status === "string" ? parsedSummary.status : "operational-failure",
        diagnostics: Array.isArray(parsedSummary.diagnostics) ? parsedSummary.diagnostics : [],
        failures: Array.isArray(parsedSummary.failures) ? parsedSummary.failures : [],
        format_failed: Array.isArray(parsedSummary.format_failed) ? parsedSummary.format_failed : [],
        exhausted: parsedSummary.exhausted === true,
      };
      if (
        summary.diagnostics.length > 0 ||
        summary.failures.length > 0 ||
        summary.format_failed.length > 0
      ) {
        await client.app.log({
          body: {
            service: "format-and-lint",
            level: "warn",
            message: providerFeedbackMessage(summary),
            extra: {
              diagnostics: summary.diagnostics,
              failures: summary.failures,
              exhausted: summary.exhausted === true,
              repairRequested: summary.exhausted !== true,
            },
          },
        });
      }
    },
  };
};

async function main() {
  const mode = process.argv[2] ?? "";

  if (mode === "session-start" || mode === "post") {
    await runCodexSnapshotMode(mode);
    return;
  }

  if (mode === "claude" || mode === "cursor" || mode === "opencode") {
    await runSingleFileMode(mode);
    return;
  }

  if (mode === "files") {
    const root = repoRoot(process.cwd());
    const summary = root
      ? await formatAndLintFiles(root, process.argv.slice(3))
      : emptyLintSummary("operational_failure", [
          { stage: "config-load", command: "git rev-parse --show-toplevel", message: "Not inside a Git repository" },
        ]);
    process.stdout.write(JSON.stringify(summary));
    return;
  }

  if (mode === "preview") {
    const root = repoRoot(process.cwd());
    const summary = root
      ? await verifyLintFiles(root, process.argv.slice(3))
      : emptyLintSummary("operational_failure", [
          { stage: "config-load", command: "git rev-parse --show-toplevel", message: "Not inside a Git repository" },
        ]);
    process.stdout.write(JSON.stringify(summary));
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath && path.basename(invokedPath) === path.basename(modulePath)) {
  await main();
}

#!/usr/bin/env node
/// <reference types="node" />
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { resolveManagedLint, buildManagedLintCommand } from "./managed-lint.mjs";

/** @param {unknown} error - A filesystem or subprocess boundary failure. */
const missingFile = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
/** @param {unknown} error - A filesystem or subprocess boundary failure. */
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {value is import("./managed-lint-runner.mjs").ManagedLintDiagnostic} */
const isDiagnostic = (value) =>
  isRecord(value) &&
  typeof value.message === "string" &&
  ["filename", "code", "severity"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );
/** @param {string} file @param {unknown} [missingValue] @returns {Promise<unknown>} */
const readJson = async (file, missingValue = null) => {
  try {
    /** @type {unknown} */
    const value = JSON.parse(await readFile(file, "utf-8"));
    return value;
  } catch (error) {
    if (missingFile(error)) {
      return missingValue;
    }
    throw error;
  }
};
/** @param {string} root @param {readonly string[]} [paths] @param {string} [scope] */
export const loadManagedLint = async (root, paths, scope) =>
  await resolveManagedLint({
    root,
    selection: await readJson(path.join(root, ".devpunks/specs/lint/selection.json")),
    settings: await readJson(path.join(root, ".devpunks/settings.json"), {}),
    ...(paths === undefined ? {} : { paths }),
    ...(scope === undefined ? {} : { scope }),
  });
/** @param {string} cwd @returns {Promise<string>} */
const discoverRoot = async (cwd) => {
  try {
    await access(path.join(cwd, ".devpunks/settings.json"));
    return cwd;
  } catch (error) {
    if (!missingFile(error)) {
      throw error;
    }
  }
  const parent = path.dirname(cwd);
  if (parent === cwd) {
    throw new Error(
      "Select software scopes in .devpunks/settings.json lint.scopes, or pass --root.",
    );
  }
  return await discoverRoot(parent);
};
/** @param {string} root @param {string} cwd @returns {NodeJS.ProcessEnv} */
export const managedLintEnvironment = (root, cwd) => {
  const bins = [];
  let current = cwd;
  while (true) {
    bins.push(path.join(current, "node_modules/.bin"));
    if (current === root) {
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  bins.push(path.dirname(process.execPath));
  const node = spawnSync("node", ["--print", "process.execPath"], { encoding: "utf-8" });
  const nodePath = node.stdout?.trim();
  if (node.status === 0 && nodePath !== undefined && path.isAbsolute(nodePath)) {
    bins.push(path.dirname(nodePath));
  }
  return { ...process.env, PATH: [...new Set(bins)].join(path.delimiter) };
};
/** @param {string} stdout - Structured output from the local Oxlint subprocess.
 * @returns {{ diagnostics: readonly import("./managed-lint-runner.mjs").ManagedLintDiagnostic[], empty: boolean } | null} A valid report, or null for malformed output.
 */
const readLintOutput = (stdout) => {
  const notice = [
    "No files found matching the given patterns.",
    "No files found to lint. Please check your paths and ignore patterns.",
  ].find((candidate) => stdout.startsWith(`${candidate}\n`));
  try {
    /** @type {unknown} */
    const value = JSON.parse(notice === undefined ? stdout : stdout.slice(notice.length + 1));
    if (
      isRecord(value) &&
      Array.isArray(value.diagnostics) &&
      value.diagnostics.every(isDiagnostic) &&
      (notice === undefined || (value.diagnostics.length === 0 && value.number_of_files === 0))
    ) {
      return { diagnostics: value.diagnostics, empty: notice !== undefined };
    }
  } catch {
    // Malformed/config output is operational, even if the subprocess exits zero.
  }
  return null;
};
/** @param {string} stderr - Node's benign warning for a typeless package's ESM config. */
const hasOnlyModuleTypeWarnings = (stderr) =>
  stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .every(
      (line) =>
        /^\(node:\d+\) \[MODULE_TYPELESS_PACKAGE_JSON\] Warning: Module type of .+ is not specified and it doesn't parse as CommonJS\.$/u.test(
          line,
        ) ||
        line ===
          "Reparsing as ES module because module syntax was detected. This incurs a performance overhead." ||
        /^To eliminate this warning, add "type": "module" to .+\.$/u.test(line) ||
        line === "(Use `node --trace-warnings ...` to show where the warning was created)",
    );
/** @param {Omit<LintBatch, "code">} batch - One local Oxlint process and its validated structured output.
 * @returns {0 | 1 | 2} The public clean, findings, or operational-failure exit code.
 */
const lintExitCode = ({ result, report, stderr }) => {
  if (result.error !== undefined || result.signal !== null || report === null) {
    return 2;
  }
  if (!hasOnlyModuleTypeWarnings(stderr)) {
    return 2;
  }
  if (result.status === 0) {
    return 0;
  }
  if (result.status !== 1) {
    return 2;
  }
  if (report.empty) {
    return 0;
  }
  return report.diagnostics.length > 0 ? 1 : 2;
};
/** @param {LintBatch} batch - Original process evidence and validated structured output.
 * @returns {NonNullable<import("./managed-lint-runner.mjs").ManagedLintExecution["failure"]>} The operational failure's presentation context.
 */
const lintFailure = ({ result, report, stdout, stderr }) => {
  if (result.error !== undefined || result.signal !== null || result.status === null) {
    return { kind: "process", phase: "lint" };
  }
  if (result.status !== 0 && /^Failed to parse oxlint configuration file\./mu.test(stdout)) {
    return { kind: "config-load", phase: "config" };
  }
  if (!hasOnlyModuleTypeWarnings(stderr) && /config|load/iu.test(stderr)) {
    return { kind: "config-load", phase: "lint" };
  }
  return { kind: report === null ? "malformed-output" : "process", phase: "lint" };
};
/**
 * Byte budget for one Oxlint argv. Linux rejects a single argument over 128 KiB and a whole
 * argv plus environment over ARG_MAX (2 MiB on Linux, 1 MiB on macOS); 96 KiB stays below both.
 */
const argumentBudget = 96 * 1024;
/** @param {string} argument - One argv entry. @returns {number} Bytes the argument occupies in argv, with its NUL and pointer. */
const argumentSize = (argument) => Buffer.byteLength(argument) + 9;
/**
 * Split items into consecutive batches whose summed size stays within the budget. An item larger
 * than the budget still gets its own batch, so no input is ever dropped.
 * @param {readonly string[]} items - Ordered inputs.
 * @param {(item: string) => number} size - Cost of one input.
 * @param {number} budget - Maximum summed cost of one batch.
 * @returns {string[][]} Consecutive batches covering every input once, in order.
 */
export const batchBySize = (items, size, budget) => {
  /** @type {string[][]} */
  const batches = [];
  /** @type {string[]} */
  let current = [];
  let used = 0;
  for (const item of items) {
    const cost = size(item);
    if (current.length > 0 && used + cost > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += cost;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
};
/** @param {readonly string[]} args - Resolver arguments ending in `--` and the explicit files. @returns {string[][]} Invocations that each stay within the argument budget. */
const argumentBatches = (args) => {
  const separator = args.indexOf("--");
  if (separator === -1) {
    return [[...args]];
  }
  const fixed = args.slice(0, separator + 1);
  const budget = argumentBudget - fixed.reduce((total, arg) => total + argumentSize(arg), 0);
  const batches = batchBySize(args.slice(separator + 1), argumentSize, budget);
  return batches.length === 0 ? [[...args]] : batches.map((files) => [...fixed, ...files]);
};
/**
 * @typedef {object} LintBatch
 * @property {import("node:child_process").SpawnSyncReturns<Buffer>} result - Native process evidence.
 * @property {ReturnType<typeof readLintOutput>} report - Validated structured output, or null.
 * @property {string} stdout - Complete tool stdout.
 * @property {string} stderr - Complete tool stderr.
 * @property {0 | 1 | 2} code - Clean, findings, or operational failure for this batch.
 */
/** Run one Oxlint batch with stdout and stderr streamed to files, so no output size can truncate the report.
 * @param {{ command: import("./managed-lint-runner.mjs").ReadyManagedLintCommand, args: readonly string[], env: NodeJS.ProcessEnv, directory: string, index: number }} options - The batch and its scratch directory.
 * @returns {LintBatch} The classified batch.
 */
const runBatch = ({ command, args, env, directory, index }) => {
  const stdoutFile = path.join(directory, `${index}.stdout`);
  const stderrFile = path.join(directory, `${index}.stderr`);
  const stdoutFd = openSync(stdoutFile, "w");
  const stderrFd = openSync(stderrFile, "w");
  let result;
  try {
    result = spawnSync(command.executable, args, {
      cwd: command.cwd,
      env,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  const stdout = readFileSync(stdoutFile, "utf-8");
  const stderr = readFileSync(stderrFile, "utf-8");
  const report = readLintOutput(stdout);
  const batch = { report, result, stderr, stdout };
  return { ...batch, code: lintExitCode(batch) };
};
/**
 * Classify all batches as one owner run: any operational failure wins; otherwise findings when a batch
 * found problems or the owner's summed warnings exceed `--max-warnings` (each batch only sees its share).
 * @param {readonly LintBatch[]} batches - Batches in run order; stops after the first failure.
 * @param {readonly string[]} args - The owner's full command arguments.
 * @returns {{ code: 0 | 1 | 2, evidence: LintBatch, diagnostics: readonly import("./managed-lint-runner.mjs").ManagedLintDiagnostic[] | undefined }} The owner result.
 */
const combineBatches = (batches, args) => {
  const failed = batches.find((batch) => batch.code === 2);
  // Native evidence comes from the batch that decided the result, so status agrees with code.
  const evidence = failed ?? batches.find((batch) => batch.code === 1) ?? batches.at(-1);
  if (evidence === undefined) {
    throw new Error("Managed lint command has no invocation.");
  }
  if (failed !== undefined) {
    return { code: 2, diagnostics: failed.report?.diagnostics, evidence };
  }
  const diagnostics = batches.flatMap((batch) => batch.report?.diagnostics ?? []);
  const limit = args.indexOf("--max-warnings");
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const found =
    batches.some((batch) => batch.code === 1) ||
    (limit !== -1 && warnings > Number(args[limit + 1]));
  return { code: found ? 1 : 0, diagnostics, evidence };
};
/** @param {import("./managed-lint-runner.mjs").ManagedLintExecutionOptions} options - One resolver-produced command. @returns {import("./managed-lint-runner.mjs").ManagedLintExecution} The classified owner run. */
export const executeManagedLintCommand = ({ root, command, output = "json" }) => {
  const env = managedLintEnvironment(root, command.cwd);
  const directory = mkdtempSync(path.join(os.tmpdir(), "hi-managed-lint-"));
  /** @type {LintBatch[]} */
  const batches = [];
  try {
    for (const args of argumentBatches(command.args)) {
      const batch = runBatch({ args, command, directory, env, index: batches.length });
      batches.push(batch);
      if (batch.code === 2) {
        break;
      }
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
  const { code, diagnostics, evidence } = combineBatches(batches, command.args);
  const stderr = batches.map((batch) => batch.stderr).join("");
  const stdout =
    output === "json" || code === 2 || diagnostics === undefined
      ? batches.map((batch) => batch.stdout).join("")
      : diagnostics
          .map(
            (item) =>
              `${item.filename ?? command.scope}: ${item.severity ?? "error"}: ${item.message} (${item.code ?? "lint"})`,
          )
          .join("\n") + (diagnostics.length > 0 ? "\n" : "");
  return {
    code,
    command,
    error: evidence.result.error,
    scope: command.scope,
    signal: evidence.result.signal,
    status: evidence.result.status,
    stderr: stderr === "" ? (evidence.result.error?.message ?? "") : stderr,
    stdout,
    ...(code === 2 ? { failure: lintFailure(evidence) } : {}),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
};
/** @param {import("./managed-lint-runner.mjs").ManagedLintRunOptions} options @returns {Promise<import("./managed-lint-runner.mjs").ManagedLintRunResult>} */
const executeManagedLint = async ({ root, scope, paths, output = "human" }) => {
  let resolution = await loadManagedLint(root, paths, scope);
  if (resolution.status === "disabled") {
    return { code: 0, results: [], status: "clean" };
  }
  if (resolution.status !== "ready") {
    return { ...resolution, code: 2 };
  }
  if (resolution.routes.some((route) => route.triggered)) {
    const complete = await loadManagedLint(root);
    if (complete.status !== "ready") {
      return { ...complete, code: 2 };
    }
    resolution = {
      ...resolution,
      routes: resolution.routes.map((route) =>
        route.triggered
          ? (complete.routes.find((item) => item.scope === route.scope) ?? route)
          : route,
      ),
    };
  }
  const commands = await Promise.all(
    resolution.routes
      .filter((item) => scope === undefined || scope === item.scope)
      .map(async (route) => await buildManagedLintCommand({ output: "json", root, route })),
  );
  const failure = commands.find(
    (command) => command.status !== "ready" && command.status !== "empty",
  );
  if (failure !== undefined) {
    return { ...failure, code: 2, results: [] };
  }
  const results = commands
    .filter((command) => command.status === "ready")
    .map((command) => executeManagedLintCommand({ command, output, root }));
  /** @type {0 | 1 | 2} */
  let code = 0;
  if (results.some((result) => result.code !== 0)) {
    code = 1;
  }
  if (results.some((result) => result.code === 2)) {
    code = 2;
  }
  /** @type {readonly ["clean", "findings", "operational-failure"]} */
  const statuses = ["clean", "findings", "operational-failure"];
  return { code, results, status: statuses[code] };
};
/** @param {import("./managed-lint-runner.mjs").ManagedLintRunOptions} options @returns {Promise<import("./managed-lint-runner.mjs").ManagedLintRunResult>} */
export const runManagedLint = async (options) => {
  try {
    return await executeManagedLint(options);
  } catch (error) {
    return { code: 2, diagnostics: [errorMessage(error)], status: "conflict" };
  }
};

/** @param {string} content - NUL-separated, or newline-separated when it holds no NUL. @returns {string[]} */
const parseFileList = (content) =>
  content.split(content.includes("\0") ? "\0" : /\r?\n/u).filter((file) => file.length > 0);

/** @param {readonly string[]} args - Command-line arguments after the script. @returns {{ root?: string, scope?: string, output: "human" | "json", paths?: string[] }} Parsed options. */
const parseArguments = (args) => {
  /** @type {{ root?: string, scope?: string, output: "human" | "json", paths?: string[] }} */
  const options = { output: "human" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      options.paths = [...(options.paths ?? []), ...args.slice(index + 1)];
      break;
    }
    const value = args[index + 1];
    if (!["--root", "--scope", "--format", "--files-from"].includes(arg) || value === undefined) {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    index += 1;
    if (value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === "--root") {
      options.root = path.resolve(value);
    } else if (arg === "--scope") {
      options.scope = value;
    } else if (arg === "--files-from") {
      // `-` reads the list from standard input; lists never travel through argv (#232).
      const list = readFileSync(value === "-" ? 0 : path.resolve(value), "utf-8");
      options.paths = [...(options.paths ?? []), ...parseFileList(list)];
    } else if (value === "human" || value === "json") {
      options.output = value;
    } else {
      throw new Error("--format must be human or json");
    }
  }
  return options;
};

const main = async () => {
  const { root, scope, output, paths } = parseArguments(process.argv.slice(2));
  const resolvedRoot = root ?? (await discoverRoot(process.cwd()));
  const result = await runManagedLint({
    output,
    paths: paths?.map((file) =>
      path.relative(resolvedRoot, path.resolve(file)).split(path.sep).join("/"),
    ),
    root: resolvedRoot,
    scope,
  });
  if (output === "json") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    for (const owner of result.results ?? []) {
      process.stdout.write(owner.stdout);
      process.stderr.write(owner.stderr);
    }
  }
  for (const diagnostic of result.diagnostics ?? []) {
    process.stderr.write(`${diagnostic}\n`);
  }
  process.exitCode = result.code;
};
// Bundling rewrites import.meta.filename to the host CLI; retain the standalone asset identity.
if (
  process.argv[1] !== undefined &&
  path.basename(process.argv[1]) === "managed-lint-runner.mjs" &&
  path.resolve(process.argv[1]) === import.meta.filename
) {
  try {
    await main();
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 2;
  }
}

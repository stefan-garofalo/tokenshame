#!/usr/bin/env node
/// <reference types="node" />

import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import path from "node:path";
import { promisify } from "node:util";

import { isManagedQualityPathExcluded } from "./managed-lint.mjs";
import { batchBySize, loadManagedLint } from "./managed-lint-runner.mjs";

// oxlint-disable-next-line typescript/strict-void-return -- promisify takes Node's callback-style execFile.
const execFile = promisify(execFileCallback);
/** @param {unknown} value - Untrusted decoded input. @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value - Decoded generated contract. @returns {value is import("./commit-gate-runner.d.ts").CommitGateRunnerContract} */
const isContract = (value) =>
  isRecord(value) &&
  ["lint", "formatCheck"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  ) &&
  (typeof value.lint === "string" || typeof value.formatCheck === "string") &&
  ["owner", "path", "root"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  ) &&
  (value.execution === undefined ||
    (isRecord(value.execution) &&
      ["lint", "formatCheck"].every(
        (key) => value.execution[key] === undefined || typeof value.execution[key] === "string",
      )));
/** Byte budget for one `sh -c` command string; Linux rejects a single argument over 128 KiB (#232). */
const commandBudget = 96 * 1024;
/** Staged listings of large repositories exceed Node's 1 MiB default output buffer (#232). */
const stagedListingBuffer = 256 * 1024 * 1024;

/**
 * Run one check with output streamed to files, so output size never truncates or fails the check.
 * @param {{ command: string, cwd: string, environment: NodeJS.ProcessEnv, output: string }} options - Shell command, owner directory, extra environment, and output file prefix.
 */
const run = async ({ command, cwd, environment, output }) => {
  const stdoutHandle = await open(`${output}.stdout`, "w");
  const stderrHandle = await open(`${output}.stderr`, "w");
  let code = 1;
  let launchError = "";
  try {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...environment },
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
    });
    // `once` rejects when the child emits `error`, e.g. a missing owner directory.
    /** @type {unknown[]} */
    const closed = await once(child, "close");
    const [status, signal] = closed;
    code = typeof status === "number" ? status : 1;
    launchError = typeof signal === "string" ? `signal ${signal}` : "";
  } catch (error) {
    const details = isRecord(error) ? error : {};
    launchError = `${typeof details.code === "string" ? details.code : ""}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    await stdoutHandle.close();
    await stderrHandle.close();
  }
  return {
    code,
    launchError,
    stderr: await readFile(`${output}.stderr`, "utf-8"),
    stdout: await readFile(`${output}.stdout`, "utf-8"),
  };
};

/** @param {string} root - Active worktree. @param {string} cwd - Owner directory. @returns {string} PATH with owner-to-root node_modules/.bin first. */
const toolPath = (root, cwd) => {
  const bins = [];
  let current = cwd;
  while (current === root || current.startsWith(`${root}${path.sep}`)) {
    bins.push(path.join(current, "node_modules/.bin"));
    if (current === root) {
      break;
    }
    current = path.dirname(current);
  }
  return [...bins, process.env.PATH ?? ""].join(path.delimiter);
};

const stagedPaths = async () => {
  const { stdout } = await execFile(
    "git",
    ["diff", "--cached", "--name-status", "--find-renames", "-z"],
    { maxBuffer: stagedListingBuffer },
  );
  const entries = stdout.split("\0").filter(Boolean);
  /** @type {Set<string>} */
  const triggers = new Set();
  /** @type {Set<string>} */
  const files = new Set();
  /** @type {Set<string>} */
  const deleted = new Set();
  for (let index = 0; index < entries.length; index += 2) {
    const status = entries[index];
    let file = entries[index + 1];
    if (status.startsWith("R") || status.startsWith("C")) {
      if (status.startsWith("R")) {
        triggers.add(file);
      }
      index += 1;
      file = entries[index + 1];
    }
    triggers.add(file);
    if (status === "D") {
      deleted.add(file);
    } else {
      files.add(file);
    }
  }
  return { deleted, files: [...files], triggers: [...triggers] };
};

/** @param {string} root - Active worktree. @returns {Promise<unknown>} Decoded settings, or undefined when missing or malformed. */
const readSettings = async (root) => {
  /** @type {unknown} */
  let settings;
  try {
    settings = JSON.parse(await readFile(path.join(root, ".devpunks/settings.json"), "utf-8"));
  } catch {
    // Missing or malformed settings leave the gate on; managed lint reports the settings problem.
  }
  return settings;
};

/** @param {string} root - Active worktree. @returns {Promise<boolean>} Whether settings declare `commitGate: "disabled"`. */
const commitGateDisabled = async (root) => {
  const settings = await readSettings(root);
  return isRecord(settings) && settings.commitGate === "disabled";
};

/** @param {unknown} settings - Decoded settings. @returns {string[]} Settings `lint.exclude` patterns. */
const lintExclude = (settings) =>
  isRecord(settings) && isRecord(settings.lint) && Array.isArray(settings.lint.exclude)
    ? settings.lint.exclude.filter((pattern) => typeof pattern === "string")
    : [];

const activeWorktreeRoot = async () => {
  const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], {});
  return stdout.replace(/\n$/u, "");
};

/** @param {string} value - A filename passed through an explicit authored shell template. */
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Run an expandable check with `{files-from}` set to the list file and `{files}` expanded in argument
 * batches that each stay within the command budget, in order; the first failing batch decides the
 * exit. Verbatim checks run once as authored.
 * @param {{ template: string, expand: boolean, files: readonly string[], cwd: string, list: string, output: string, root: string }} options - One deduplicated check, its staged list file, and output file prefix.
 */
const runCheck = async ({ template, expand, files, cwd, list, output, root }) => {
  const environment = { HI_STAGED_FILES_PATH: list, PATH: toolPath(root, cwd) };
  const command = expand ? template.replaceAll("{files-from}", shellQuote(list)) : template;
  const placeholders = expand ? command.split("{files}").length - 1 : 0;
  const batches =
    placeholders === 0 || files.length === 0
      ? [command]
      : batchBySize(
          files.map(shellQuote),
          (argument) => placeholders * (Buffer.byteLength(argument) + 1),
          commandBudget - Buffer.byteLength(command),
        ).map((batch) => command.replaceAll("{files}", batch.join(" ")));
  const results = [];
  for (const [index, batch] of batches.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- Batches of one check run in order to keep its output ordered and its load bounded.
    results.push(await run({ command: batch, cwd, environment, output: `${output}-${index}` }));
  }
  const failure = results.find((result) => result.code !== 0);
  return {
    code: failure?.code ?? 0,
    launchError: failure?.launchError ?? "",
    stderr: results.map((result) => result.stderr).join(""),
    stdout: results.map((result) => result.stdout).join(""),
  };
};

/** @param {string} name - Public command option. */
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
};

const contractsPath = argument("--contracts");
if (contractsPath === null) {
  console.error("Commit Gate runner requires --contracts <path>.");
  process.exitCode = 2;
} else {
  try {
    const contractsContent = await readFile(contractsPath, "utf-8");
    /** @type {unknown} */
    const decodedContracts = JSON.parse(contractsContent);
    if (!Array.isArray(decodedContracts) || !decodedContracts.every(isContract)) {
      throw new Error("Commit Gate contracts must contain explicit lint and formatCheck commands.");
    }
    const contracts = decodedContracts;
    const worktreeRoot = await activeWorktreeRoot();
    if (await commitGateDisabled(worktreeRoot)) {
      process.exit(0);
    }
    const staged = await stagedPaths();
    if (staged.triggers.length === 0) {
      process.exit(0);
    }

    // Repository-mode checks cover every staged path outside the wiki, lint.exclude, and Managed Artifact
    // homes, including paths outside all Software Scopes.
    const exclude = lintExclude(await readSettings(worktreeRoot));
    const repositoryTriggers = contracts.some((contract) =>
      Object.values(contract.execution ?? {}).includes("repository"),
    )
      ? staged.triggers.filter((file) => !isManagedQualityPathExcluded({ exclude, path: file }))
      : [];
    const resolution = await loadManagedLint(worktreeRoot, staged.triggers);
    if (resolution.status === "disabled") {
      process.exit(0);
    }
    if (resolution.status !== "ready") {
      throw new Error(resolution.diagnostics.join("\n"));
    }
    const routes = new Map(resolution.routes.map((route) => [route.scope, route]));
    const eligible = new Set(resolution.routes.flatMap((route) => route.files));
    staged.triggers = staged.triggers.filter(
      (file) =>
        eligible.has(file) ||
        resolution.routes.some(
          (route) =>
            route.triggered &&
            (route.inputs.includes(file) ||
              route.config === file ||
              file === ".devpunks/settings.json" ||
              file === ".devpunks/specs/lint/selection.json"),
        ),
    );
    staged.files = staged.files.filter((file) => eligible.has(file));
    if (staged.triggers.length === 0 && repositoryTriggers.length === 0) {
      process.exit(0);
    }
    const complete = resolution.routes.some((route) => route.triggered)
      ? await loadManagedLint(worktreeRoot)
      : resolution;
    if (complete.status !== "ready") {
      throw new Error(complete.diagnostics.join("\n"));
    }
    /** @type {Map<string, {checks: {kind: string, owner: string}[], template: string, cwd: string, expand: boolean, files: string[]}>} */
    const commands = new Map();
    /** @type {readonly ("lint" | "formatCheck")[]} */
    const kinds = ["lint", "formatCheck"];
    const repositoryKinds = new Set(
      kinds.filter((kind) =>
        contracts.some((contract) => contract.execution?.[kind] === "repository"),
      ),
    );
    const covered = new Map(kinds.map((kind) => [kind, new Set()]));
    const coverageFailures = [];
    for (const contract of contracts) {
      const relativePath = path.posix.normalize(contract.path ?? ".");
      const ownerCwd = path.resolve(worktreeRoot, relativePath);
      const owner = contract.owner ?? ownerCwd;
      const route = routes.get(relativePath);
      const ownerTriggers = staged.triggers.filter(
        (file) =>
          (route?.files.includes(file) ?? false) ||
          (route?.triggered === true &&
            (route.inputs.includes(file) ||
              route.config === file ||
              file === ".devpunks/settings.json" ||
              file === ".devpunks/specs/lint/selection.json")),
      );
      const ownerFiles =
        route?.triggered === true
          ? (complete.routes.find((item) => item.scope === relativePath)?.files ?? [])
          : staged.files.filter((file) => route?.files.includes(file) ?? false);
      for (const kind of kinds) {
        const template = contract[kind];
        if (template === undefined) {
          continue;
        }
        const mode = contract.execution?.[kind];
        const triggers =
          mode === "repository"
            ? [...new Set([...repositoryTriggers, ...staged.triggers])]
            : ownerTriggers;
        const routedFiles = mode === "repository" ? staged.files : ownerFiles;
        const files = routedFiles.map((file) =>
          path.relative(ownerCwd, path.resolve(worktreeRoot, file)).split(path.sep).join("/"),
        );
        if (repositoryKinds.has(kind) && mode !== "repository") {
          continue;
        }
        if (triggers.length === 0 && mode !== "repository") {
          continue;
        }
        if (contract.execution !== undefined && !["files", "owner", "repository"].includes(mode)) {
          coverageFailures.push(
            `${kind} for ${owner} requires an execution mode of files, owner, or repository`,
          );
          continue;
        }
        const expandable = template.includes("{files}") || template.includes("{files-from}");
        if (mode === "files" && !expandable) {
          coverageFailures.push(
            `${kind} for ${owner} in files mode requires an explicit {files} or {files-from} placeholder`,
          );
          continue;
        }
        const fileMode = mode === undefined || mode === "files";
        // Deleted files leave nothing to check: an owner staged only through deletions passes its file checks.
        if (
          fileMode &&
          route?.triggered !== true &&
          triggers.every((file) => staged.deleted.has(file))
        ) {
          for (const file of triggers) {
            covered.get(kind).add(file);
          }
          continue;
        }
        if (fileMode && files.length === 0) {
          coverageFailures.push(
            `${kind} for ${owner} needs existing staged files: ${triggers.join(", ")}`,
          );
          continue;
        }
        // Owner and repository commands run verbatim; file lists expand only for files and legacy modes.
        let command = template;
        if (mode === "files") {
          command = template;
        } else if (mode === undefined) {
          const scopedTemplate = template.replace(/(?<prefix>^|\s)\.\s*$/u, "$<prefix>{files}");
          command =
            scopedTemplate.includes("{files}") || scopedTemplate.includes("{files-from}")
              ? scopedTemplate
              : `${scopedTemplate} -- {files}`;
        }
        for (const file of triggers) {
          covered.get(kind).add(file);
        }
        const key = JSON.stringify([ownerCwd, command, files]);
        const existing = commands.get(key);
        if (existing === undefined) {
          commands.set(key, {
            checks: [{ kind, owner }],
            cwd: ownerCwd,
            expand: fileMode,
            files,
            template: command,
          });
        } else {
          existing.checks.push({ kind, owner });
        }
      }
    }
    for (const kind of kinds) {
      const uncovered = staged.triggers.filter((file) => !covered.get(kind).has(file));
      if (uncovered.length > 0) {
        coverageFailures.push(`${kind} has no command for: ${uncovered.join(", ")}`);
      }
    }
    if (coverageFailures.length > 0) {
      throw new Error(
        `Commit Gate coverage missing:\n${coverageFailures.join("\n")}\nAdd the owning package to lint.scopes in .devpunks/settings.json, then run hi update to rebuild the Commit Gate contracts.`,
      );
    }
    // File lists travel through a temporary list file, never argv or the environment (#232).
    const scratch = await mkdtemp(path.join(os.tmpdir(), "hi-commit-gate-"));
    let results;
    try {
      results = await Promise.all(
        [...commands.values()].map(async (command, index) => {
          const list = path.join(scratch, `${index}.files`);
          await writeFile(list, command.files.map((file) => `${file}\0`).join(""));
          return {
            ...command,
            ...(await runCheck({
              ...command,
              list,
              output: path.join(scratch, `${index}`),
              root: worktreeRoot,
            })),
          };
        }),
      );
    } finally {
      await rm(scratch, { force: true, recursive: true });
    }
    for (const result of results) {
      if (result.code === 0) {
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
      } else {
        for (const check of result.checks) {
          process.stderr.write(
            `Commit Gate ${check.kind} failed for ${check.owner} in ${result.cwd} (exit ${result.code})${result.launchError === "" ? "" : `: ${result.launchError}`}.\n`,
          );
        }
        process.stderr.write(`${result.stdout}${result.stderr}`);
      }
    }
    process.exitCode = results.some((result) => result.code !== 0) ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

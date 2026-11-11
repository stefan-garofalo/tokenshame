#!/usr/bin/env node

// Session-start Baseline check (ARC-009, FLOW-004). Keys only on `hi check --json` `status`
// and never claims drift is absent: `hi check` compares versions, it does not run the Drift Check.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const installedRecordPath = ".devpunks/installed.json";
// Below the 60 s harness timeout so the hook reports instead of being killed.
const checkTimeoutMs = 45_000;
const notInstalledMessage =
  "Harness Baseline not installed in this worktree; run hi update (or hi init).";
const noStatusMessage = "hi check did not return a status. Drift was not checked.";

const statusMessages = {
  current: ({ installed }) => `Harness Baseline ${installed} is current.`,
  "not-installed": () => notInstalledMessage,
  unavailable: ({ installed }) =>
    `Harness Registry unavailable. Installed Baseline: ${installed}. Drift was not checked.`,
  "update-available": ({ installed, latest }) =>
    `Harness Baseline update available: ${installed} -> ${latest}. Run hi update.`,
};

function readStdinJson() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return {};
  }
}

function repoRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (result.status === 0 && result.stdout.trim()) || cwd;
}

function runCheckCommand(root) {
  for (const command of ["hi", "hint"]) {
    const result = spawnSync(command, ["check", "--json"], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: checkTimeoutMs,
    });
    if (result.error?.code !== "ENOENT") {
      return result.stdout ?? "";
    }
  }
  return "";
}

function parseCheckResult(stdout) {
  try {
    const result = JSON.parse(stdout);
    return result !== null && typeof result === "object" && Object.hasOwn(statusMessages, result.status)
      ? result
      : null;
  } catch {
    return null;
  }
}

function checkBaseline(root) {
  if (!existsSync(path.join(root, installedRecordPath))) {
    return { message: notInstalledMessage, status: "not-installed" };
  }

  const result = parseCheckResult(runCheckCommand(root));
  if (result === null) {
    return { message: noStatusMessage, status: "no-status" };
  }

  const version = (value) => (typeof value === "string" && value.length > 0 ? value : "unknown");
  return {
    message: statusMessages[result.status]({
      installed: version(result.installed),
      latest: version(result.latest),
    }),
    status: result.status,
  };
}

function formatForHarness(message, harness) {
  if (harness === "cursor") {
    return JSON.stringify({
      additional_context: message,
      agent_message: message,
      continue: true,
      user_message: message,
    });
  }
  return message;
}

function rootFromInput(input) {
  const candidates = [
    input.cwd,
    input.workspace_root,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.PWD,
    process.cwd(),
  ].filter((value) => typeof value === "string" && value.length > 0);

  return repoRoot(candidates[0]);
}

function main() {
  const harness = process.argv[2] ?? "plain";
  const { message } = checkBaseline(rootFromInput(readStdinJson()));
  process.stdout.write(`${formatForHarness(message, harness)}\n`);
}

// OpenCode loads every export of a plugin module as a plugin function; export nothing else.
export const ScaffoldUpdateCheckPlugin = async ({ client, directory, worktree }) => ({
  event: async ({ event }) => {
    if (event.type !== "session.created") {
      return;
    }

    const result = checkBaseline(repoRoot(worktree || directory || process.cwd()));
    await client.app.log({
      body: {
        level: result.status === "current" ? "info" : "warn",
        message: result.message,
        service: "scaffold-update-check",
      },
    });
  },
});

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = import.meta.filename;

if (invokedPath && path.basename(invokedPath) === path.basename(modulePath)) {
  main();
}

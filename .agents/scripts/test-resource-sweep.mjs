#!/usr/bin/env node

// Removes only proven orphans among labeled test containers (#292). A test that starts a container labels it
// `hi.test-resource=true` and `hi.owner-pid=<test process pid>`. Exited labeled containers are removed; any
// other labeled container only when its owner PID is dead on this machine. Unlabeled containers are never
// touched. Missing Docker never fails: a session-end hook runs this with `--detach`.
//
//   node .agents/scripts/test-resource-sweep.mjs [--dry-run] [--detach]

import { spawn, spawnSync } from "node:child_process";

const resourceLabel = "hi.test-resource";
const ownerLabel = "hi.owner-pid";
const dockerTimeoutMs = 30_000;

const docker = (args) =>
  spawnSync("docker", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: dockerTimeoutMs,
  });

/** Docker joins `docker ps` labels as `key=value,key=value`. */
const parseLabels = (joined) =>
  Object.fromEntries(
    (joined ?? "")
      .split(",")
      .filter((pair) => pair.includes("="))
      .map((pair) => {
        const [key, ...value] = pair.split("=");
        return [key, value.join("=")];
      }),
  );

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error.code === "EPERM";
  }
};

/** The reason a container is a proven orphan, or `undefined` to keep it. */
const orphanReason = (state, labels) => {
  if (state === "exited" || state === "dead") {
    return state;
  }
  const pid = Number(labels[ownerLabel]);
  return Number.isSafeInteger(pid) && pid > 0 && !isAlive(pid)
    ? `owner pid ${pid} is dead`
    : undefined;
};

function sweep(dryRun) {
  const listing = docker([
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    `label=${resourceLabel}=true`,
    "--format",
    "{{json .}}",
  ]);
  if (listing.error?.code === "ENOENT") {
    console.log("test-resource sweep skipped: docker is not installed.");
    return 0;
  }
  if (listing.error || listing.status !== 0) {
    console.log("test-resource sweep skipped: the Docker daemon is unavailable.");
    return 0;
  }

  let [removed, kept, failed] = [0, 0, 0];
  for (const line of listing.stdout.split("\n").filter((row) => row.trim() !== "")) {
    const { ID: id, Labels, Names: name, State: state } = JSON.parse(line);
    const labels = parseLabels(Labels);
    // Never trust the daemon filter alone: an unlabeled container is never removed.
    if (labels[resourceLabel] !== "true") {
      continue;
    }
    const reason = orphanReason(state, labels);
    if (reason === undefined) {
      kept += 1;
      continue;
    }
    const container = `${name} ${id.slice(0, 12)}`;
    if (dryRun) {
      console.log(`would remove ${container} (${reason})`);
      removed += 1;
      continue;
    }
    // `--volumes` also removes the container's anonymous volumes.
    const removal = docker(["rm", "--force", "--volumes", id]);
    if (removal.status === 0) {
      console.log(`removed ${container} (${reason})`);
      removed += 1;
    } else {
      console.log(`failed to remove ${container}: ${(removal.stderr ?? "").trim().split("\n")[0]}`);
      failed += 1;
    }
  }

  const failures = failed > 0 ? `, failed ${failed}` : "";
  console.log(
    dryRun
      ? `test-resource sweep (dry run): would remove ${removed}, kept ${kept}.`
      : `test-resource sweep: removed ${removed}, kept ${kept}${failures}.`,
  );
  return failed > 0 ? 1 : 0;
}

const args = process.argv.slice(2);
if (args.includes("--detach")) {
  // Session-end hooks have a short time budget: return at once and sweep in a process the harness cannot kill.
  spawn(process.execPath, [import.meta.filename, ...args.filter((arg) => arg !== "--detach")], {
    detached: true,
    stdio: "ignore",
  }).unref();
} else {
  process.exitCode = sweep(args.includes("--dry-run"));
}

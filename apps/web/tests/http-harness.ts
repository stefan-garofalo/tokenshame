import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Builds the web app once and starts the built server on a free port, so HTTP
// tests see what the Vercel function serves. Any number of test files can call
// `startServer`: the build is shared, skipped while it is newer than every source
// file, and guarded by a lock so parallel files never build twice. The build bakes
// in the site address, so it always runs with `productionHost` as the production host.

const run = promisify(execFile);

const webRoot = fileURLToPath(new URL("..", import.meta.url));
// Written after the build; a build by anyone else wipes it, so it proves this harness built.
// It holds the production host baked into that build.
const builtMarker = path.join(webRoot, ".output/.http-harness");
const builtEntry = path.join(webRoot, ".output/server/index.mjs");
const buildLock = path.join(webRoot, ".output.build-lock");
const sourceRoots = [
  path.join(webRoot, "src"),
  path.join(webRoot, "../../packages/share-link/src"),
  path.join(webRoot, "../../packages/ui/src"),
];
const sourceFiles = ["vite.config.ts", "package.json", ".env.schema"].map((name) =>
  path.join(webRoot, name),
);
export const productionHost = "tokenshame.test";
export const siteOrigin = `https://${productionHost}`;
const startTimeoutMs = 30_000;
const pollIntervalMs = 100;
const buildOutputLimit = 16 * 1024 * 1024;

// Vitest and the deployment leak variables the build and the server must not read:
// the resolved varlock blob and values of the test run (process env outranks the
// schema), NODE_ENV=test (React would build in development mode), and the Vercel
// variables. Callers set NODE_ENV themselves.
const leakedPrefixes = ["VERCEL", "VITEST", "__VARLOCK"];
const leakedNames = new Set(["MODE", "NODE_ENV", "SITE_ORIGIN", "TEST"]);

export const localEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !(leakedNames.has(name) || leakedPrefixes.some((prefix) => name.startsWith(prefix))),
    ),
  );

const modifiedAt = (file: string) => statSync(file).mtimeMs;

const newestSourceTime = () =>
  Math.max(
    ...sourceFiles.map(modifiedAt),
    ...sourceRoots.flatMap((root) =>
      readdirSync(root, { recursive: true }).map((name) =>
        modifiedAt(path.join(root, name.toString())),
      ),
    ),
  );

// Fresh when this harness built it for `productionHost` and nothing rebuilt it since:
// a foreign `vite build` rewrites the entry after the marker, or wipes the marker.
const isBuildFresh = () =>
  existsSync(builtMarker) &&
  existsSync(builtEntry) &&
  readFileSync(builtMarker, "utf-8") === productionHost &&
  modifiedAt(builtMarker) >= modifiedAt(builtEntry) &&
  modifiedAt(builtMarker) > newestSourceTime();

const tryLockBuild = () => {
  try {
    mkdirSync(buildLock);
    return true;
  } catch {
    return false;
  }
};

const waitForUnlock = async (): Promise<void> => {
  if (existsSync(buildLock)) {
    await sleep(pollIntervalMs);
    await waitForUnlock();
  }
};

// A killed run can leave `.output.build-lock` behind; delete it to unblock.
const ensureBuilt = async (): Promise<void> => {
  if (isBuildFresh()) {
    return;
  }
  if (!tryLockBuild()) {
    await waitForUnlock();
    await ensureBuilt();
    return;
  }
  try {
    await run("bun", ["run", "build"], {
      cwd: webRoot,
      env: {
        ...localEnv(),
        NODE_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: productionHost,
      },
      maxBuffer: buildOutputLimit,
    });
    writeFileSync(builtMarker, productionHost);
  } finally {
    rmSync(buildLock, { force: true, recursive: true });
  }
};

const freePort = async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe path.
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, "close");
  return port;
};

const hasExited = (server: ChildProcess) => server.exitCode !== null || server.signalCode !== null;

export interface WebServer {
  readonly url: string;
  readonly stop: () => Promise<void>;
}

const waitUntilServing = async (
  url: string,
  server: ChildProcess,
  log: () => string,
  deadline: number,
): Promise<void> => {
  if (hasExited(server)) {
    throw new Error(`web server exited during start\n${log()}`);
  }
  if (Date.now() > deadline) {
    throw new Error(`web server did not answer in time\n${log()}`);
  }
  const answered = await fetch(url, { redirect: "manual" }).then(
    () => true,
    () => false,
  );
  if (!answered) {
    await sleep(pollIntervalMs);
    await waitUntilServing(url, server, log, deadline);
  }
};

/** Starts the built web server on a free port. */
export const startServer = async (): Promise<WebServer> => {
  await ensureBuilt();
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const env = localEnv();
  // Vercel has no node_modules/.bin: only the node binary is on PATH, and the
  // function sits in a folder with no node_modules above it (tools such as varlock
  // search upward from their own file). So serve a copy of the output from the temp dir.
  const cwd = mkdtempSync(path.join(tmpdir(), "web-server-"));
  cpSync(path.join(webRoot, ".output"), path.join(cwd, ".output"), { recursive: true });
  env.PATH = path.dirname(process.execPath);
  env.HOST = "127.0.0.1";
  env.NODE_ENV = "production";
  env.PORT = String(port);
  const server = spawn(process.execPath, [path.join(cwd, ".output/server/index.mjs")], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const collect = (chunk: Buffer) => {
    log += chunk.toString();
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  const stop = async () => {
    if (!hasExited(server)) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    rmSync(cwd, { force: true, recursive: true });
  };
  try {
    await waitUntilServing(url, server, () => log, Date.now() + startTimeoutMs);
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop, url };
};

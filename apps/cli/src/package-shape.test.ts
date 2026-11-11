import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

// The test packs the CLI exactly as `npm publish` would, then inspects the tarball a user downloads.

const PackedFile = Schema.Struct({ mode: Schema.Int, path: Schema.String });
const PackResult = Schema.Array(Schema.Struct({ files: Schema.Array(PackedFile) }));
const Manifest = Schema.Struct({
  bin: Schema.Record(Schema.String, Schema.String),
  dependencies: Schema.optionalKey(Schema.Unknown),
  engines: Schema.Record(Schema.String, Schema.String),
  keywords: Schema.optionalKey(Schema.Array(Schema.String)),
  license: Schema.optionalKey(Schema.String),
  name: Schema.String,
  optionalDependencies: Schema.optionalKey(Schema.Unknown),
  peerDependencies: Schema.optionalKey(Schema.Unknown),
  private: Schema.optionalKey(Schema.Boolean),
  repository: Schema.optionalKey(
    Schema.Struct({
      directory: Schema.String,
      type: Schema.String,
      url: Schema.String,
    }),
  ),
  version: Schema.String,
});

interface Packed {
  readonly files: readonly (typeof PackedFile.Type)[];
  readonly manifest: typeof Manifest.Type;
  readonly unpackedDir: string;
}

const decodePack = Schema.decodeUnknownSync(Schema.fromJsonString(PackResult));
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const stalePath = "dist/stale-sentinel.mjs";
// npm may add these next to package.json; nothing else outside dist/ may ship.
const npmExtras = new Set(["README", "README.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);

// `import x from "m"`, `import "m"`, `import("m")`, `export * from "m"` and `require("m")`.
const specifier = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?<target>[^"']+)["']/gu;
const commentLine = /^\s*(?:\*|\/\/|\/\*)/u;
const bannedPath = /web|fixture|\.test\.|\.map$/iu;

const isOwnerExecutable = (mode: number): boolean => Math.floor(mode / 0o100) % 2 === 1;

const isAllowedFile = (file: string): boolean =>
  file === "package.json" ||
  npmExtras.has(file) ||
  (file.startsWith("dist/") && file.endsWith(".mjs") && !file.slice("dist/".length).includes("/"));

/** Code lines only: bundled Effect doc comments quote `import ... from "effect"` examples. */
const codeOf = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !commentLine.test(line))
    .join("\n");

const readPacked = (unpackedDir: string, file: string): string =>
  readFileSync(path.join(unpackedDir, "package", file), "utf-8");

/** Packs `apps/cli` into `workDir` the way `npm publish` does and unpacks the tarball beside it. */
const pack = (workDir: string): Packed => {
  // A leftover file in dist must not ship: `prepack` has to rebuild a clean dist.
  mkdirSync(path.join(cliRoot, "dist"), { recursive: true });
  writeFileSync(path.join(cliRoot, stalePath), "export {};\n");

  const stdout = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], {
    cwd: cliRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The `prepack` build logs to stdout before npm prints its JSON, which is a lone `[` line to the end.
  const [result] = decodePack(stdout.slice(stdout.lastIndexOf("\n[\n") + 1));
  const unpackedDir = path.join(workDir, "unpacked");
  mkdirSync(unpackedDir);
  const tarball = readdirSync(workDir).find((name) => name.endsWith(".tgz")) ?? "";
  execFileSync("tar", ["-xzf", path.join(workDir, tarball), "-C", unpackedDir]);

  return {
    files: result?.files ?? [],
    manifest: decodeManifest(readPacked(unpackedDir, "package.json")),
    unpackedDir,
  };
};

describe("packed CLI package", () => {
  let workDir = "";
  let packed: Packed | undefined;

  const current = (): Packed => {
    if (packed === undefined) {
      throw new Error("the CLI was not packed");
    }
    return packed;
  };
  const packedPaths = (): readonly string[] => current().files.map((file) => file.path);

  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "tokenshame-pack-"));
    packed = pack(workDir);
  });

  afterAll(() => {
    rmSync(workDir, { force: true, recursive: true });
  });

  it("declares no runtime dependencies", () => {
    const { dependencies, optionalDependencies, peerDependencies } = current().manifest;
    assert.deepStrictEqual(
      [dependencies, optionalDependencies, peerDependencies],
      [undefined, undefined, undefined],
    );
  });

  it("requires Node >=22.13", () => {
    assert.deepStrictEqual(current().manifest.engines, { node: ">=22.13" });
  });

  it("is a public package named tokenshame", () => {
    const { manifest } = current();
    assert.strictEqual(manifest.name, "tokenshame");
    assert.isUndefined(manifest.private);
    assert.strictEqual(manifest.version, "0.1.0");
    assert.strictEqual(manifest.license, "MIT");
    assert.deepStrictEqual(manifest.repository, {
      directory: "apps/cli",
      type: "git",
      url: "git+https://github.com/stefan-garofalo/tokenshame.git",
    });
    assert.isAbove(manifest.keywords?.length ?? 0, 0);
  });

  it("ships a bin that npx can run", () => {
    assert.deepStrictEqual(current().manifest.bin, { tokenshame: "dist/index.mjs" });
    const bin = current().files.find((file) => file.path === "dist/index.mjs");
    assert.isDefined(bin);
    assert.isTrue(isOwnerExecutable(bin?.mode ?? 0), "bin must be executable");
    assert.isTrue(
      readPacked(current().unpackedDir, "dist/index.mjs").startsWith("#!/usr/bin/env node\n"),
    );
  });

  it("holds only dist files, package.json, and npm's own README or LICENSE", () => {
    assert.deepStrictEqual(
      packedPaths().filter((file) => !isAllowedFile(file)),
      [],
    );
    assert.include(packedPaths(), "package.json");
  });

  it("holds no web build, fixture, test, or source map", () => {
    assert.deepStrictEqual(
      packedPaths().filter((file) => bannedPath.test(file)),
      [],
    );
  });

  it("never ships a stale file from an earlier build", () => {
    assert.notInclude(packedPaths(), stalePath);
  });

  it("imports only node:* modules and its own chunks", () => {
    const own = new Set(packedPaths().map((file) => `./${path.basename(file)}`));
    const stray: string[] = [];
    for (const file of packedPaths().filter((name) => name.endsWith(".mjs"))) {
      for (const match of codeOf(readPacked(current().unpackedDir, file)).matchAll(specifier)) {
        const target = match.groups?.target ?? "";
        if (!target.startsWith("node:") && !own.has(target)) {
          stray.push(`${file}: ${target}`);
        }
      }
    }
    assert.deepStrictEqual(stray, []);
  });
});

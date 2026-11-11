import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** @typedef {import('./managed-lint.mjs').ManagedLintRoute} Route */
/** @typedef {import('./managed-lint.mjs').ManagedLintSelection} Selection */
/** @typedef {import('./managed-lint.mjs').ManagedLintPolicyInput} PolicyInput */
/** @typedef {import('./managed-lint.mjs').ManagedLintResolution} Resolution */
/** @typedef {import('./managed-lint.mjs').ManagedLintCommand} Command */
/** @typedef {import('./managed-lint.mjs').ResolveManagedLintOptions} ResolveOptions */
/** @typedef {import('./managed-lint.mjs').BuildManagedLintCommandOptions} CommandOptions */
/** @typedef {import('./managed-lint.mjs').ManagedQualityPathOptions} PathOptions */
/** @typedef {import('./managed-lint.mjs').ResolvedManagedLintRoute} ResolvedRoute */
/** @typedef {Route & {boundaries: string[], files: string[], triggered: boolean}} MutableRoute */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value @param {string} key @returns {unknown} */
const field = (value, key) => (record(value) ? value[key] : undefined);
/** @param {unknown} value @returns {value is unknown[]} */
const array = (value) => Array.isArray(value);
/** @param {unknown} error @returns {string} */
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string} scope @param {string} file @returns {boolean} */
const contains = (scope, file) => scope === "." || file === scope || file.startsWith(`${scope}/`);
/** @param {string} file @returns {boolean} */
const wiki = (file) => ["wiki", "app/wiki", "apps/wiki"].some((scope) => contains(scope, file));
/** @param {unknown} value @returns {value is string} */
const validPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.includes("\\") &&
  !path.posix.isAbsolute(value) &&
  value.split("/").every((part) => part !== ".." && part !== "") &&
  path.posix.normalize(value) === value;
/** @param {unknown} value @returns {value is string[]} */
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
/** Managed Artifact homes at the repository root: installed harness files, never project source. */
const managedHomes = new Set([
  ".agents",
  ".claude",
  ".codex",
  ".cursor",
  ".devpunks",
  ".devpunks-cache",
  ".opencode",
  "opensrc",
]);
/** @param {string} file @returns {boolean} */
const blocked = (file) =>
  managedHomes.has(file.split("/")[0] ?? "") ||
  file.split("/").some((part) => ["node_modules", ".git", ".devpunks"].includes(part));
/** @param {readonly string[]} a @param {readonly string[]} b @returns {boolean} */
const same = (a, b) =>
  JSON.stringify([...new Set(a)].toSorted()) === JSON.stringify([...new Set(b)].toSorted());
/** @param {string} message @returns {import("./managed-lint.mjs").ManagedLintFailure} */
const conflict = (message) => ({ diagnostics: [message], status: "conflict" });
/** @param {string} file @returns {Promise<boolean>} */
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (field(error, "code") === "ENOENT") {
      return false;
    }
    throw error;
  }
};

// Portable glob subset used by saved exclusions: *, **, ?, character classes and brace alternatives.
// No dependency on Node's newer path.matchesGlob API in consumer hooks.
/** @param {string} file @param {string} pattern @returns {boolean} */
const matchesGlob = (file, pattern) => {
  let source = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      source += "(?:";
      braces += 1;
    } else if (char === "}" && braces > 0) {
      source += ")";
      braces -= 1;
    } else if (char === "," && braces > 0) {
      source += "|";
    } else if (char === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        throw new Error(`Unclosed exclusion character class: ${pattern}`);
      }
      let group = pattern.slice(i + 1, end);
      if (group.startsWith("!")) {
        group = `^${group.slice(1)}`;
      }
      source += `[${group}]`;
      i = end;
    } else {
      source += char.replaceAll(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  if (braces !== 0) {
    throw new Error(`Unclosed exclusion alternatives: ${pattern}`);
  }
  return new RegExp(`^(?:${source})$`, "u").test(file);
};

/** @param {PathOptions} options @returns {boolean} @throws {TypeError} Invalid repository-relative path. */
export const isManagedQualityPathExcluded = ({ path: file, exclude }) => {
  if (!validPath(file)) {
    throw new TypeError("Managed quality path must be normalized and repository-relative.");
  }
  return (
    wiki(file) ||
    blocked(file) ||
    exclude.some(
      (pattern) =>
        matchesGlob(file, pattern) || matchesGlob(`${file}/`, pattern) || contains(pattern, file),
    )
  );
};

/** @param {string} root @param {string} file @returns {boolean} */
const containsPhysical = (root, file) => {
  const relative = path.relative(path.resolve(root), file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
};

/** @param {string} root @param {string} file @param {boolean} canonical @returns {Promise<boolean>} */
const containedRealPath = async (root, file, canonical = false) => {
  const actualRoot = await realpath(root);
  /** @param {string} current @returns {Promise<boolean>} */
  const resolveExisting = async (current) => {
    try {
      const actual = await realpath(current);
      return (
        containsPhysical(actualRoot, actual) &&
        (!canonical || actual === path.resolve(actualRoot, path.relative(root, current)))
      );
    } catch (error) {
      if (field(error, "code") !== "ENOENT") {
        throw error;
      }
      if (current === path.dirname(current)) {
        return false;
      }
      return await resolveExisting(path.dirname(current));
    }
  };
  return await resolveExisting(file);
};

/** @param {unknown} inputs @returns {inputs is readonly PolicyInput[] | undefined} */
const validPolicyInputs = (inputs) =>
  inputs === undefined ||
  (array(inputs) &&
    inputs.every(
      (input) =>
        record(input) &&
        validPath(input.path) &&
        typeof input.sha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(input.sha256),
    ));

/** @param {string} root @param {Route} route @returns {Promise<void>} */
const verifyPolicyInputs = async (root, route) => {
  await Promise.all(
    (route.policyInputs ?? []).map(async (input) => {
      const absolute = path.resolve(root, input.path);
      const stale = () =>
        new Error(
          `Stale project policy input ${input.path}; run hi update to compile current policy.`,
        );
      if (!(await containedRealPath(root, absolute)) || !(await exists(absolute))) {
        throw stale();
      }
      const info = await stat(absolute);
      if (!info.isFile()) {
        throw stale();
      }
      const hash = createHash("sha256")
        .update(await readFile(absolute))
        .digest("hex");
      if (hash !== input.sha256) {
        throw stale();
      }
    }),
  );
};

/** Git's view of an owner: tracked plus untracked-but-not-ignored paths, relative to root.
 * @param {string} root @param {string} scope
 * @returns {string[] | null} Null when root is outside a Git work tree or Git is unavailable. */
const gitFiles = (root, scope) => {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", scope],
    {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1", LC_ALL: "C" },
      maxBuffer: Number.POSITIVE_INFINITY,
    },
  );
  if (field(result.error, "code") === "ENOENT" || result.stderr.includes("not a git repository")) {
    return null;
  }
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.trim() || errorMessage(result.error)}`);
  }
  return [...new Set(result.stdout.split("\0"))].filter(
    (file) => file !== "" && contains(scope, file),
  );
};

/** Filesystem fallback outside Git: regular files below scope, skipping pruned directories.
 * @param {string} root @param {string} scope @param {(directory: string) => boolean} pruned @returns {Promise<string[]>} */
const walkFiles = async (root, scope, pruned) => {
  /** @param {string} directory @returns {Promise<string[]>} */
  const visit = async (directory) => {
    const entries = await readdir(path.resolve(root, directory), { withFileTypes: true });
    const children = await Promise.all(
      entries.map(async (entry) => {
        const child = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) {
          return pruned(child) ? [] : await visit(child);
        }
        return entry.isFile() ? [child] : [];
      }),
    );
    return children.flat();
  };
  return await visit(scope);
};

/** Keep listed paths that are regular files on disk; Git also lists deleted, sparse and gitlink paths.
 * @param {string} root @param {readonly string[]} files @returns {Promise<string[]>} */
const regularFiles = async (root, files) => {
  const kept = await Promise.all(
    files.map(async (file) => {
      try {
        const info = await lstat(path.resolve(root, file));
        return info.isFile() ? [file] : [];
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(String(field(error, "code")))) {
          return [];
        }
        throw error;
      }
    }),
  );
  return kept.flat();
};

/** Memoized "this directory or an ancestor below scope matches".
 * @param {string} scope @param {(directory: string) => boolean} test @returns {(directory: string) => boolean} */
const below = (scope, test) => {
  /** @type {Map<string, boolean>} */
  const seen = new Map();
  /** @param {string} directory @returns {boolean} */
  const check = (directory) => {
    if (directory === scope) {
      return false;
    }
    const known = seen.get(directory);
    if (known !== undefined) {
      return known;
    }
    const hit = check(path.posix.dirname(directory)) || test(directory);
    seen.set(directory, hit);
    return hit;
  };
  return check;
};

const manifests = new Set(["package.json", "pyproject.toml"]);

/** Eligible source files and outermost unselected nested projects of one owner.
 * Inside a Git work tree only Git-visible files count, so ignored build output is never linted
 * and never forms a boundary.
 * @param {string} root @param {string} scope @param {readonly string[]} scopes @param {readonly string[]} exclude
 * @returns {Promise<{boundaries: string[], files: string[]}>} Nested project directories and files outside them. */
const ownerFiles = async (root, scope, scopes, exclude) => {
  /** @param {string} file @returns {boolean} */
  const excluded = (file) => isManagedQualityPathExcluded({ exclude, path: file });
  const pruned = below(scope, excluded);
  const listed = gitFiles(root, scope);
  const files =
    listed === null
      ? await walkFiles(root, scope, pruned)
      : await regularFiles(
          root,
          listed.filter((file) => !pruned(path.posix.dirname(file))),
        );
  const projects = new Set(
    files
      .filter((file) => manifests.has(path.posix.basename(file)))
      .map((file) => path.posix.dirname(file))
      .filter((directory) => directory !== scope && !scopes.includes(directory)),
  );
  const nested = below(scope, (directory) => projects.has(directory));
  return {
    boundaries: [...projects]
      .filter((directory) => !nested(path.posix.dirname(directory)))
      .toSorted(),
    files: files.filter((file) => !excluded(file) && !nested(path.posix.dirname(file))),
  };
};

/** @param {unknown} route @returns {route is Route} */
const validRoute = (route) =>
  record(route) &&
  validPath(route.scope) &&
  !wiki(route.scope) &&
  !blocked(route.scope) &&
  validPath(route.config) &&
  route.config === path.posix.join(route.scope, "oxlint.config.ts") &&
  record(route.tool) &&
  route.tool.package === "oxlint" &&
  (route.tool.typeAwareBackend === undefined || route.tool.typeAwareBackend === "tsrs") &&
  validPolicyInputs(route.policyInputs) &&
  strings(route.inputs) &&
  route.inputs.every(validPath) &&
  (route.maxWarnings === null ||
    (typeof route.maxWarnings === "number" &&
      Number.isInteger(route.maxWarnings) &&
      route.maxWarnings >= 0));

/** @param {unknown} artifact @param {readonly string[]} scopes @param {readonly string[]} exclude @returns {artifact is Selection} */
const validSelection = (artifact, scopes, exclude) =>
  record(artifact) &&
  artifact.version === 1 &&
  strings(artifact.scopes) &&
  strings(artifact.exclude) &&
  same(scopes, artifact.scopes) &&
  same(exclude, artifact.exclude) &&
  array(artifact.routes) &&
  artifact.routes.length === new Set(scopes).size &&
  artifact.routes.every(validRoute) &&
  same(
    artifact.routes.map((route) => route.scope),
    scopes,
  );

/** @param {string} root @param {Route} route @param {readonly string[]} scopes @param {readonly string[]} exclude @returns {Promise<{route: MutableRoute, files: string[]}>} */
const resolveOwner = async (root, route, scopes, exclude) => {
  if (!(await containedRealPath(root, path.resolve(root, route.scope)))) {
    throw new Error(`Selected owner escapes repository: ${route.scope}`);
  }
  if (!(await exists(path.resolve(root, route.scope, "package.json")))) {
    throw new Error(`Selected owner is missing: ${route.scope}`);
  }
  const canonicalRoot = await realpath(root);
  if (
    (await realpath(path.resolve(root, route.scope))) !== path.resolve(canonicalRoot, route.scope)
  ) {
    throw new Error(`Selected owner must not alias another directory: ${route.scope}`);
  }
  await verifyPolicyInputs(root, route);
  const owner = await ownerFiles(root, route.scope, scopes, exclude);
  return {
    files: owner.files,
    route: { ...route, boundaries: owner.boundaries, files: [], triggered: false },
  };
};

/** @param {unknown} value @returns {value is string[]} */
const validPaths = (value) => strings(value) && value.every(validPath);
/** @param {unknown} value @returns {value is string[] | undefined} */
const optionalPaths = (value) => value === undefined || validPaths(value);
/** @param {unknown} value @returns {boolean} */
const validSettings = (value) => record(value) && (value.lint === undefined || record(value.lint));

/** @param {string} file @returns {boolean} */
const isSelectionInput = (file) =>
  file === ".devpunks/settings.json" || file === ".devpunks/specs/lint/selection.json";

/** @param {string} file @param {Route} route @returns {boolean} */
const isRouteDependency = (file, route) =>
  route.inputs.includes(file) || file === route.config || isSelectionInput(file);

/** @param {readonly string[]} scopes @param {string} file @returns {string | undefined} */
const ownerScope = (scopes, file) =>
  scopes
    .filter((scope) => contains(scope, file))
    .toSorted((a, b) => (b === "." ? 0 : b.length) - (a === "." ? 0 : a.length))[0];

/** @param {unknown} selection @returns {string[] | null} */
const migrationConflicts = (selection) => {
  const conflicts = field(field(selection, "lintEvidence"), "conflicts");
  if (conflicts === undefined) {
    return [];
  }
  if (!array(conflicts)) {
    return null;
  }
  const locations = conflicts.map((item) => field(item, "path"));
  return strings(locations) ? locations : null;
};
/** @param {string} file @param {readonly string[]} locations @returns {boolean} */
const isMigrationInput = (file, locations) =>
  locations.some(
    (location) =>
      location === file ||
      location.startsWith(`${file}#`) ||
      (location.startsWith(`${file}:`) && /^:\d+$/u.test(location.slice(file.length))),
  );

/** @param {string} root - Repository directory.
 * @param {readonly string[]} scopes - Saved software owners.
 * @param {readonly string[]} exclude - Validated exclusions.
 * @param {readonly {file: string, owner: string}[]} owned - Requests requiring boundary proof.
 * @returns {Promise<boolean>} Whether all requests belong to unselected nested projects.
 */
const outsideBoundaries = async (root, scopes, exclude, owned) => {
  /** @type {Map<string, ReturnType<typeof ownerFiles>>} */
  const observed = new Map();
  /** @param {number} index @returns {Promise<boolean>} */
  const visit = async (index) => {
    const candidate = owned[index];
    if (candidate === undefined) {
      return true;
    }
    const pending =
      observed.get(candidate.owner) ?? ownerFiles(root, candidate.owner, scopes, exclude);
    observed.set(candidate.owner, pending);
    const { boundaries } = await pending;
    if (!boundaries.some((boundary) => contains(boundary, candidate.file))) {
      return false;
    }
    return await visit(index + 1);
  };
  try {
    return await visit(0);
  } catch {
    // Incomplete boundary evidence defers to normal owner validation and its diagnostics.
    return false;
  }
};

/** Prove no work without validating unrelated adopted policy or tool health.
 * @param {ResolveOptions} options - The explicit path request and available route authority.
 * @param {readonly string[] | undefined} scopes - Saved software owners, when selected.
 * @param {readonly string[]} exclude - Validated project exclusions.
 * @returns {Promise<boolean>} Whether every path is outside source and dependency work.
 */
const excludedRequest = async ({ root, selection, paths }, scopes, exclude) => {
  if (paths === undefined || paths.length === 0) {
    return false;
  }
  if (scopes?.some((scope) => wiki(scope) || blocked(scope)) === true) {
    return false;
  }
  const artifact = field(selection, "managedLint");
  const routes = artifact === undefined ? [] : field(artifact, "routes");
  // Stale but readable routes still own dependencies. Malformed routes cannot prove absence.
  if (!array(routes) || !routes.every(validRoute)) {
    return false;
  }
  const conflicts = migrationConflicts(selection);
  if (conflicts === null) {
    return false;
  }
  if (
    paths.some(
      (file) =>
        isSelectionInput(file) ||
        isMigrationInput(file, conflicts) ||
        scopes?.some((scope) => file === path.posix.join(scope, "oxlint.config.ts")) === true ||
        routes.some((route) => isRouteDependency(file, route)),
    )
  ) {
    return false;
  }
  const remaining = paths.filter((file) => !isManagedQualityPathExcluded({ exclude, path: file }));
  if (remaining.length === 0) {
    return true;
  }
  if (scopes === undefined) {
    return false;
  }
  const owned = remaining.flatMap((file) => {
    const owner = ownerScope(scopes, file);
    return owner === undefined ? [] : [{ file, owner }];
  });
  return await outsideBoundaries(root, scopes, exclude, owned);
};

/** @param {ResolveOptions} options @returns {Promise<Resolution>} */
const resolveRoutes = async ({ root, settings, selection, paths, scope }) => {
  const lint = field(settings, "lint");
  if (!validSettings(settings)) {
    return conflict("Managed lint settings and lint must be objects.");
  }
  const scopes = field(lint, "scopes");
  if (!optionalPaths(scopes)) {
    return conflict("lint.scopes must contain exact repository-relative package paths.");
  }
  const exclude = field(lint, "exclude") ?? [];
  if (
    !strings(exclude) ||
    !exclude.every((pattern) => validPath(pattern) && !pattern.startsWith("!"))
  ) {
    return conflict("lint.exclude must be a list of repository-relative patterns.");
  }
  if (scopes?.length === 0) {
    return { diagnostics: [], status: "disabled" };
  }
  if (!optionalPaths(paths)) {
    return conflict("Lint input paths must be repository-relative and contained.");
  }
  if (scope !== undefined && scopes?.includes(scope) !== true) {
    return conflict(`Scope ${scope} is not a selected software owner.`);
  }
  if (
    await excludedRequest(
      { root, selection, settings, ...(paths === undefined ? {} : { paths }) },
      scopes,
      exclude,
    )
  ) {
    return { excludedPaths: [...new Set(paths)].toSorted(), routes: [], status: "ready" };
  }
  if (scopes === undefined) {
    return {
      diagnostics: ["Select exact software scopes in .devpunks/settings.json lint.scopes."],
      status: "selection-needed",
    };
  }
  const artifact = field(selection, "managedLint");
  if (!validSelection(artifact, scopes, exclude)) {
    return conflict(
      "Managed lint selection is stale or invalid; run hi update after selecting scopes.",
    );
  }
  const owners = await Promise.all(
    artifact.routes.map(async (route) => await resolveOwner(root, route, scopes, exclude)),
  );
  const routes = owners.map((owner) => owner.route);
  const requested = paths ?? owners.flatMap((owner) => owner.files);
  if (!validPaths(requested)) {
    return conflict("Lint input paths must be repository-relative and contained.");
  }
  /** @type {string[]} */
  const excludedPaths = [];
  await Promise.all(
    [...new Set(requested)].map(async (file) => {
      for (const dependent of routes) {
        if (isRouteDependency(file, dependent)) {
          dependent.triggered = true;
        }
      }
      const selectedScope = ownerScope(scopes, file);
      const owner = routes.find((route) => route.scope === selectedScope);
      if (
        owner === undefined ||
        isManagedQualityPathExcluded({ exclude, path: file }) ||
        owner.boundaries.some((boundary) => contains(boundary, file)) ||
        !(await containedRealPath(root, path.resolve(root, file), true))
      ) {
        excludedPaths.push(file);
      } else {
        owner.files.push(file);
      }
    }),
  );
  return {
    excludedPaths: excludedPaths.toSorted(),
    routes: routes.map((route) => ({ ...route, files: route.files.toSorted() })),
    status: "ready",
  };
};

/** @param {ResolveOptions} options @returns {Promise<Resolution>} */
export const resolveManagedLint = async (options) => {
  try {
    return await resolveRoutes(options);
  } catch (error) {
    return conflict(`Cannot resolve managed lint inputs: ${errorMessage(error)}`);
  }
};

/**
 * Find a package bin with an upward walk confined to the repository.
 * @param {string} root @param {string} directory @param {string} name @param {string} [binName] The bin entry; defaults to the package name.
 * @returns {Promise<{executable: string, version: string} | undefined>} The bin and package version, or undefined when absent.
 */
const resolveBin = async (root, directory, name, binName = name) => {
  const manifest = path.join(directory, "node_modules", name, "package.json");
  if (await exists(manifest)) {
    /** @type {unknown} */
    const value = JSON.parse(await readFile(manifest, "utf-8"));
    if (!record(value) || value.name !== name || typeof value.version !== "string") {
      throw new Error(`Invalid local ${name} manifest at ${manifest}`);
    }
    const entry = typeof value.bin === "string" ? value.bin : field(value.bin, binName);
    // npm accepts `./`-prefixed bin paths, as `@effect/tsgo` publishes.
    const bin = typeof entry === "string" ? entry.replace(/^\.\//u, "") : entry;
    if (!validPath(bin)) {
      throw new Error(`Invalid local ${name} executable at ${manifest}`);
    }
    const executable = path.resolve(path.dirname(manifest), bin);
    if (!(await exists(executable))) {
      throw new Error(`Local ${name} executable is missing: ${executable}`);
    }
    return { executable, version: value.version };
  }
  const atTop = directory === path.resolve(root) || !containsPhysical(root, directory);
  return atTop ? undefined : await resolveBin(root, path.dirname(directory), name, binName);
};

/** @param {string} version @param {number} minimum @returns {boolean} Whether this `@effect/tsgo` is at least `0.<minimum>.0`. */
const effectTsgoAtLeast = (version, minimum) => {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 0 || minor >= minimum;
};

/**
 * Resolve the local Oxlint. When `@effect/tsgo` ships the proxy, run Oxlint through it, so Effect
 * rules need no patched `node_modules`.
 * A `tsrs` route runs the type-aware rules on tsrs (`--tsrs-lint`, 0.67.0+) instead of tsgolint.
 * @param {string} root @param {string} cwd @param {"tsrs" | undefined} typeAwareBackend
 * @returns {Promise<{executable: string, prefix: string[], version: string}>} The executable, its leading arguments, and the Oxlint version.
 */
const resolveTool = async (root, cwd, typeAwareBackend) => {
  const oxlint = await resolveBin(root, cwd, "oxlint");
  if (oxlint === undefined) {
    throw new Error(
      `No repository-local Oxlint installation for ${cwd}; install the selected toolchain.`,
    );
  }
  const proxy = await resolveBin(root, cwd, "@effect/tsgo", "effect-tsgo");
  if (typeAwareBackend === "tsrs") {
    if (proxy === undefined || !effectTsgoAtLeast(proxy.version, 67)) {
      throw new Error(
        `lint.typeAwareBackend "tsrs" needs @effect/tsgo 0.67.0 or later for ${cwd}; install it, or remove lint.typeAwareBackend from .devpunks/settings.json and run hi update.`,
      );
    }
    return {
      executable: proxy.executable,
      prefix: ["--tsrs-lint", "oxlint"],
      version: oxlint.version,
    };
  }
  return proxy !== undefined && effectTsgoAtLeast(proxy.version, 59)
    ? { executable: proxy.executable, prefix: ["oxlint"], version: oxlint.version }
    : { executable: oxlint.executable, prefix: [], version: oxlint.version };
};

/** @param {string} root @param {ResolvedRoute} route @param {string | undefined} logicalSourcePath @returns {Promise<string[]>} */
const commandFiles = async (root, route, logicalSourcePath) => {
  if (logicalSourcePath !== undefined && !route.files.includes(logicalSourcePath)) {
    throw new Error("Logical source is not in the resolved eligible file set.");
  }
  const sourcePaths = logicalSourcePath === undefined ? route.files : [logicalSourcePath];
  const files = await Promise.all(
    [...new Set(sourcePaths)].map(async (file) => {
      if (
        !validPath(file) ||
        !contains(route.scope, file) ||
        wiki(file) ||
        blocked(file) ||
        route.boundaries.some((boundary) => contains(boundary, file))
      ) {
        throw new Error("Command inputs fall outside the resolved owner.");
      }
      const absolute = path.resolve(root, file);
      if (!(await containedRealPath(root, absolute))) {
        throw new Error(`Lint input escapes repository: ${file}`);
      }
      if (!(await exists(absolute))) {
        return [];
      }
      const info = await stat(absolute);
      if (!info.isFile()) {
        throw new Error(`Lint input must be an explicit file: ${file}`);
      }
      return [path.relative(path.resolve(root, route.scope), absolute)];
    }),
  );
  return files.flat();
};

/** @param {CommandOptions} options @returns {Promise<Command>} */
const buildCommand = async ({
  root,
  route,
  output = "human",
  fix = false,
  logicalSourcePath,
  physicalInputPath,
}) => {
  if (
    physicalInputPath !== undefined &&
    (logicalSourcePath === undefined ||
      path.resolve(physicalInputPath) !== path.resolve(root, logicalSourcePath))
  ) {
    return conflict(
      "Temporary input has no proven logical-path policy parity; use a controlled repository mirror.",
    );
  }
  if (
    !validRoute(route) ||
    !strings(route.files) ||
    !strings(route.boundaries) ||
    !["human", "json"].includes(output) ||
    typeof fix !== "boolean"
  ) {
    return conflict("Invalid managed lint command route.");
  }
  await verifyPolicyInputs(root, route);
  const cwd = path.resolve(root, route.scope);
  const config = path.resolve(root, route.config);
  if (!(await containedRealPath(root, cwd)) || !(await containedRealPath(root, config))) {
    return conflict("Managed lint owner or config escapes repository.");
  }
  if (!(await exists(config))) {
    return conflict(`Effective lint config is missing: ${route.config}`);
  }
  const tool = await resolveTool(root, cwd, route.tool.typeAwareBackend);
  const files = await commandFiles(root, route, logicalSourcePath);
  if (files.length === 0) {
    return { diagnostics: [], status: "empty" };
  }
  const args = [...tool.prefix];
  if (fix) {
    args.push("--fix");
  }
  args.push("--config", config, "--disable-nested-config");
  if (route.maxWarnings !== null) {
    args.push("--max-warnings", String(route.maxWarnings));
  }
  if (output === "json") {
    args.push("--format", "json");
  }
  args.push("--", ...files);
  return {
    args,
    config,
    cwd,
    executable: tool.executable,
    logicalSourcePath,
    physicalInputPath,
    scope: route.scope,
    status: "ready",
    toolVersion: tool.version,
  };
};

/** Describe a check; execution and controlled temporary mirrors belong to adapters.
 * @param {CommandOptions} options @returns {Promise<Command>} */
export const buildManagedLintCommand = async (options) => {
  try {
    return await buildCommand(options);
  } catch (error) {
    return conflict(`Cannot construct managed lint command: ${errorMessage(error)}`);
  }
};

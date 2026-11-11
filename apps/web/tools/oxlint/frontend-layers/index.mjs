// Frontend layer model of the frontend-domain-structure skill (references/structure.md).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

import { definePlugin, defineRule } from "@oxlint/plugins";

// Route layer first; a lower rank is a higher layer.
const LAYER_RANK = new Map([
  ["route", 0],
  ["composition", 1],
  ["features", 2],
  ["entities", 3],
  ["modules", 4],
  ["integrations", 5],
  ["ui", 6],
]);
const ROUTE_FOLDERS = new Set(["app", "routes"]);
const ROUTE_ROOT_FILES = new Set(["instrumentation", "middleware", "proxy"]);
const TOP_LEVEL_FOLDERS = new Set([
  "app",
  "routes",
  "composition",
  "features",
  "entities",
  "modules",
  "integrations",
  "ui",
  "server",
]);
// Layers whose first folders are domains with an index entrypoint; ui/ is exempt.
const DOMAIN_LAYERS = new Set([
  "composition",
  "features",
  "entities",
  "modules",
  "integrations",
]);
// Layers whose domains own Data Sources in these reserved subpaths.
const SOURCE_LAYERS = new Set(["features", "entities"]);
const DATA_SOURCE_SUBPATHS = new Set(["remote", "simulated"]);
const COMPOSITION_FOLDERS = new Set(["providers", "proxy", "routing"]);
// Style and asset files: imports of these are not code edges.
const ASSET_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".json",
  ".less",
  ".png",
  ".sass",
  ".scss",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);
// Route groups `(shop)` and dynamic segments `[locale]` before an api/ folder.
const isRouteSegment = (segment) => /^\(.+\)$|^\[.+\]$/u.test(segment);
const INDEX_EXTENSIONS = new Set([".ts", ".tsx"]);

const isDirectory = (target) =>
  existsSync(target) && statSync(target).isDirectory();
const stem = (name) => path.parse(name).name;
// A code index file, such as index.ts; index.css and other assets are not entries.
const isCodeIndex = (file) =>
  stem(file) === "index" && INDEX_EXTENSIONS.has(path.extname(file));
const parentOf = (directory) => {
  const parent = path.dirname(directory);
  return parent === directory ? null : parent;
};

const findPackageRoot = (directory) => {
  if (existsSync(path.join(directory, "package.json"))) {
    return directory;
  }
  const parent = parentOf(directory);
  return parent && findPackageRoot(parent);
};

// Scope of one directory: package root and layer root, or null when the
// package has no route layer and is therefore not checked.
const scopes = new Map();
const scopeOf = (directory) => {
  if (scopes.has(directory)) {
    return scopes.get(directory);
  }
  const packageRoot = findPackageRoot(directory);
  let scope = null;
  if (packageRoot) {
    const src = path.join(packageRoot, "src");
    const layerRoot = isDirectory(src) ? src : packageRoot;
    const routed = [...ROUTE_FOLDERS].some((folder) =>
      isDirectory(path.join(layerRoot, folder))
    );
    if (routed) {
      scope = { layerRoot, packageRoot };
    }
  }
  scopes.set(directory, scope);
  return scope;
};

const hasWorkspaces = (manifestPath) => {
  if (!existsSync(manifestPath)) {
    return false;
  }
  try {
    const { workspaces } = JSON.parse(readFileSync(manifestPath, "utf-8"));
    return Array.isArray(workspaces) || Array.isArray(workspaces?.packages);
  } catch {
    return false;
  }
};

const probeMonorepo = (directory) => {
  if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    return true;
  }
  if (hasWorkspaces(path.join(directory, "package.json"))) {
    return true;
  }
  const parent = parentOf(directory);
  return parent !== null && probeMonorepo(parent);
};

// A package is in a monorepo when it or an ancestor holds pnpm-workspace.yaml
// or a package.json with workspaces. Probed once per package root per run.
const monorepos = new Map();
const isMonorepo = (packageRoot) => {
  if (!monorepos.has(packageRoot)) {
    monorepos.set(packageRoot, probeMonorepo(packageRoot));
  }
  return monorepos.get(packageRoot);
};

// An API handler sits under an api/ folder of the route layer, after route
// groups and dynamic segments (`app/api/`, `app/(shop)/api/`, `routes/api/`).
const isApiHandler = (segments) => {
  const api = segments.indexOf("api", 1);
  return (
    api !== -1 &&
    api < segments.length - 1 &&
    segments.slice(1, api).every(isRouteSegment)
  );
};

// Classifies a path under the layer root by its segments: the first gives the
// layer, the second the domain, the third the subpath. A remote/ or simulated/
// folder at any depth of a feature or entity domain marks a Data Source;
// `dataSourceRoot` is that folder's path. Returns null outside the layer root.
const locate = (layerRoot, target) => {
  const relative = path.relative(layerRoot, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  const segments = relative.split(path.sep);
  const [top] = segments;
  if (segments.length === 1) {
    const layer = ROUTE_ROOT_FILES.has(stem(top)) ? "route" : null;
    return {
      api: false,
      dataSource: null,
      dataSourceRoot: null,
      domain: null,
      layer,
      path: target,
      segments,
      subpath: null,
    };
  }
  const layer = ROUTE_FOLDERS.has(top) ? "route" : top;
  const folders = segments.slice(2).map(stem);
  const at = SOURCE_LAYERS.has(layer)
    ? folders.findIndex((folder) => DATA_SOURCE_SUBPATHS.has(folder))
    : -1;
  return {
    api: layer === "route" && isApiHandler(segments),
    dataSource: at === -1 ? null : folders[at],
    dataSourceRoot:
      at === -1 ? null : path.join(...segments.slice(0, at + 2), folders[at]),
    domain: segments.length > 2 ? segments[1] : stem(segments[1]),
    layer,
    path: target,
    segments,
    subpath: segments.length > 2 ? stem(segments[2]) : null,
  };
};

// A test or story file has `.test.`, `.spec.` or `.stories.` in its file name.
const isTestFile = ({ segments }) =>
  /\.(?:test|spec|stories)\./u.test(segments.at(-1));

// A remote/ or simulated/ folder at any depth of a feature or entity domain.
const isDataSource = ({ dataSource }) => dataSource !== null;

const sameDomain = (source, target) =>
  source.layer === target.layer && source.domain === target.domain;

// The linted file's scope and location, or null when the file is not checked.
const checkedFile = (filename) => {
  const scope = scopeOf(path.dirname(filename));
  const source = scope && locate(scope.layerRoot, filename);
  return source && { scope, source };
};

// A style or asset import, such as `./globals.css` or `../styles.css?url`.
const isAssetSpecifier = (specifier) =>
  specifier.includes("?") ||
  ASSET_EXTENSIONS.has(path.extname(specifier).toLowerCase());

// Relative specifiers resolve against the file, `@/` against the layer root;
// package specifiers and style or asset imports are ignored.
const resolve = (layerRoot, filename, specifier) => {
  if (isAssetSpecifier(specifier)) {
    return null;
  }
  if (specifier.startsWith(".")) {
    return locate(layerRoot, path.resolve(path.dirname(filename), specifier));
  }
  if (specifier.startsWith("@/")) {
    return locate(layerRoot, path.join(layerRoot, specifier.slice(2)));
  }
  return null;
};

const isStringLiteral = (node) =>
  node?.type === "Literal" && typeof node.value === "string";
const isRequire = ({ arguments: args, callee }) =>
  callee.type === "Identifier" &&
  callee.name === "require" &&
  args.length === 1;

// Builds a rule that reports each import edge (source file -> target path)
// for which `violates` holds.
const importRule = ({ description, message, violates }) =>
  defineRule({
    meta: {
      docs: { description },
      messages: { violation: message },
      type: "problem",
    },
    create(context) {
      const file = checkedFile(context.filename);
      if (!file) {
        return {};
      }
      const check = (literal) => {
        if (!isStringLiteral(literal)) {
          return;
        }
        const target = resolve(
          file.scope.layerRoot,
          context.filename,
          literal.value
        );
        if (target && violates(file.source, target)) {
          context.report({
            data: { specifier: literal.value },
            messageId: "violation",
            node: literal,
          });
        }
      };
      return {
        CallExpression: (node) => {
          if (isRequire(node)) {
            check(node.arguments[0]);
          }
        },
        ExportAllDeclaration: (node) => {
          check(node.source);
        },
        ExportNamedDeclaration: (node) => {
          check(node.source);
        },
        ImportDeclaration: (node) => {
          check(node.source);
        },
        ImportExpression: (node) => {
          check(node.source);
        },
      };
    },
  });

// Builds a rule that reports once on every file whose path under the layer root
// breaks the rule; `offendingFolder` receives the folder names, the scope and
// the located file, and returns the offending name or null.
const folderRule = ({ description, message, offendingFolder }) =>
  defineRule({
    meta: {
      docs: { description },
      messages: { violation: message },
      type: "problem",
    },
    create(context) {
      const file = checkedFile(context.filename);
      const folder =
        file &&
        offendingFolder(
          file.source.segments.slice(0, -1),
          file.scope,
          file.source
        );
      if (!folder) {
        return {};
      }
      return {
        Program: (node) => {
          context.report({ data: { folder }, messageId: "violation", node });
        },
      };
    },
  });

// Builds a rule that reports each top-level statement of a checked file for
// which `violates` holds; `applies` selects the files.
const statementRule = ({ applies, description, message, violates }) =>
  defineRule({
    meta: {
      docs: { description },
      messages: { violation: message },
      type: "problem",
    },
    create(context) {
      const file = checkedFile(context.filename);
      if (!file || !applies(file.source)) {
        return {};
      }
      return {
        Program: (program) => {
          for (const node of program.body) {
            if (violates(node)) {
              context.report({ messageId: "violation", node });
            }
          }
        },
      };
    },
  });

// A Server Contract is a server/ domain entered through its folder or index file.
const isServerContract = ({ layer, path: target, segments }) =>
  layer === "server" &&
  (stem(segments.at(-1)) === "index" || isDirectory(target));

const layerOrderRule = importRule({
  description:
    "Disallow imports of a higher layer and imports of server/ past a Server Contract outside remote/ Data Sources and API handlers.",
  message:
    "`{{specifier}}` breaks the layer order. A layer imports only lower layers and server/ Server Contracts (a domain folder or index); only remote/ Data Sources of entities/ or features/ and API handlers import other server/ files.",
  violates: (source, target) => {
    if (source.layer === "server") {
      return false;
    }
    if (target.layer === "server") {
      return (
        !source.api &&
        source.dataSource !== "remote" &&
        !isServerContract(target)
      );
    }
    const sourceRank = LAYER_RANK.get(source.layer);
    const targetRank = LAYER_RANK.get(target.layer);
    return (
      sourceRank !== undefined &&
      targetRank !== undefined &&
      targetRank < sourceRank
    );
  },
});

const routeImportsRule = importRule({
  description:
    "Allow route files to import code only from composition/, and API handlers to import only server/.",
  message:
    "`{{specifier}}` is not allowed here. Route files import code only from composition/; API handlers import only server/.",
  violates: (source, target) =>
    source.layer === "route" &&
    target.layer !== (source.api ? "server" : "composition"),
});

const noPeerFeatureRule = importRule({
  description: "Disallow a feature importing another feature.",
  message:
    "`{{specifier}}` imports another feature. Features never import each other; connect them in the nearest composition through props, slots or callbacks.",
  violates: (source, target) =>
    source.layer === "features" &&
    target.layer === "features" &&
    source.domain !== target.domain,
});

const noPeerEntityRule = importRule({
  description: "Disallow an entity importing another entity.",
  message:
    "`{{specifier}}` imports another entity. Entities never import each other; refer to another entity by its id and put logic that spans two entities in a feature.",
  violates: (source, target) =>
    source.layer === "entities" &&
    target.layer === "entities" &&
    source.domain !== target.domain,
});

// A domain is entered through its folder, a subpath folder, an index file or
// the remote/server.ts server entry; a file directly under a layer is its own domain.
const isEntrypoint = ({ path: target, segments }) =>
  segments.length === 2 ||
  stem(segments.at(-1)) === "index" ||
  (stem(segments.at(-1)) === "server" && segments.at(-2) === "remote") ||
  isDirectory(target);

const publicEntrypointRule = importRule({
  description:
    "Require cross-domain imports to target a domain or subpath index.ts or index.tsx, or remote/server.ts.",
  message:
    "`{{specifier}}` reaches past a domain entrypoint. Import the domain or subpath folder, which resolves to its index.ts or index.tsx, or remote/server.ts.",
  violates: (source, target) =>
    DOMAIN_LAYERS.has(target.layer) &&
    !sameDomain(source, target) &&
    !isEntrypoint(target),
});

// Only composition/ and tests import a Data Source, also from its own domain; files
// of one Data Source import each other. An index that re-exports one is such an import.
const dataSourceImportsRule = importRule({
  description:
    "Allow only composition/ and tests to import a Data Source, also from the Data Source's own domain.",
  message:
    "`{{specifier}}` imports a Data Source. Only composition/ and tests import remote/ and simulated/, also from their own domain; take the Data Source as an input and import ports and contract types from the domain.",
  violates: (source, target) =>
    isDataSource(target) &&
    target.dataSourceRoot !== source.dataSourceRoot &&
    source.layer !== "composition" &&
    !isTestFile(source),
});

// `.` and `./index` resolve to the importing file's own folder or its index.
const isOwnIndex = (source, target) => {
  const folder = path.dirname(source.path);
  return (
    target.path === folder ||
    (path.dirname(target.path) === folder && stem(target.path) === "index")
  );
};

const noSelfIndexImportRule = importRule({
  description: "Disallow production code importing its own folder's index.",
  message:
    "`{{specifier}}` imports this folder's own index. The index only re-exports; import the named file beside it.",
  violates: (source, target) =>
    !isTestFile(source) && isOwnIndex(source, target),
});

const isReexportOrImport = (node) =>
  node.type === "ImportDeclaration" ||
  node.type === "ExportAllDeclaration" ||
  (node.type === "ExportNamedDeclaration" && node.declaration === null) ||
  (node.type === "ExpressionStatement" && typeof node.directive === "string");

const indexReexportsOnlyRule = statementRule({
  applies: ({ layer, path: file }) =>
    DOMAIN_LAYERS.has(layer) && isCodeIndex(file),
  description: "Allow only imports and re-exports in index.ts and index.tsx.",
  message:
    "An index file only re-exports. Move this implementation into a named file beside the index.",
  violates: (node) => !isReexportOrImport(node),
});

// Value imports and re-exports of one file's text: `import type` and
// `export type` are erased at build time and carry no runtime code.
const SPECIFIERS =
  /\b(?:import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s*)?["'](?<from>[^"']+)["']|\b(?:import|require)\s*\(\s*["'](?<call>[^"']+)["']\s*\)/gu;
const COMMENTS = /\/\*[\s\S]*?\*\/|(?<lead>^|[^:"'`])\/\/.*$/gmu;
const specifiersOf = (file) =>
  [
    ...readFileSync(file, "utf-8")
      .replaceAll(COMMENTS, "$<lead>")
      .matchAll(SPECIFIERS),
  ].map(({ groups }) => groups.from ?? groups.call);

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const isFile = (target) => existsSync(target) && statSync(target).isFile();

// The code file an import resolves to: the exact file, the file with a code
// extension, a `.js` specifier's TypeScript source, or the folder's index.
const codeFile = (target) =>
  [
    target,
    ...CODE_EXTENSIONS.map((extension) => `${target}${extension}`),
    ...[".ts", ".tsx"].map((extension) =>
      target.replace(/\.[cm]?jsx?$/u, extension)
    ),
    ...CODE_EXTENSIONS.map((extension) =>
      path.join(target, `index${extension}`)
    ),
  ].find(isFile) ?? null;

const isNodeBuiltin = (specifier) =>
  specifier.startsWith("node:") ||
  builtinModules.includes(specifier.split("/")[0]);

// A file that is I/O by its place: a server.ts entry, or a file in an
// integrations/ or platform/ folder.
const isIoPath = ({ segments }) =>
  stem(segments.at(-1)) === "server" ||
  segments
    .slice(0, -1)
    .some((folder) => folder === "integrations" || folder === "platform");

// What makes one import impure, or null: `server-only`, a Node built-in, or an
// I/O file reached directly or through the files it imports.
const impurities = new Map();
const impurityOf = (layerRoot, filename, specifier) => {
  if (specifier === "server-only" || isNodeBuiltin(specifier)) {
    return `\`${specifier}\``;
  }
  const target = resolve(layerRoot, filename, specifier);
  const file = target && codeFile(target.path);
  if (!file) {
    return null;
  }
  const located = locate(layerRoot, file);
  if (located && isIoPath(located)) {
    return `\`${path.relative(layerRoot, file)}\``;
  }
  if (!impurities.has(file)) {
    // Cycle guard: a file in progress counts as pure until its walk ends.
    impurities.set(file, null);
    const reason =
      specifiersOf(file)
        .map((next) => impurityOf(layerRoot, file, next))
        .find((found) => found !== null) ?? null;
    impurities.set(file, reason);
  }
  return impurities.get(file);
};

const isTypeOnly = (node) =>
  node.importKind === "type" || node.exportKind === "type";

const serverContractPurityRule = defineRule({
  meta: {
    docs: {
      description:
        "Disallow a server/ index (Server Contract) that reaches server-only, a Node built-in, a server.ts file or an integrations/ or platform/ file.",
    },
    messages: {
      violation:
        "`{{specifier}}` makes this Server Contract impure: it reaches {{reason}}. A server/ index holds only pure code; keep I/O in server.ts.",
    },
    type: "problem",
  },
  create(context) {
    const file = checkedFile(context.filename);
    if (
      !file ||
      file.source.layer !== "server" ||
      !isCodeIndex(context.filename)
    ) {
      return {};
    }
    const check = (literal) => {
      if (!isStringLiteral(literal)) {
        return;
      }
      const reason = impurityOf(
        file.scope.layerRoot,
        context.filename,
        literal.value
      );
      if (reason) {
        context.report({
          data: { reason, specifier: literal.value },
          messageId: "violation",
          node: literal,
        });
      }
    };
    const checkDeclaration = (node) => {
      if (!isTypeOnly(node)) {
        check(node.source);
      }
    };
    return {
      CallExpression: (node) => {
        if (isRequire(node)) {
          check(node.arguments[0]);
        }
      },
      ExportAllDeclaration: checkDeclaration,
      ExportNamedDeclaration: checkDeclaration,
      ImportDeclaration: checkDeclaration,
      ImportExpression: (node) => {
        check(node.source);
      },
    };
  },
});

const isPrototypeName = (name) => {
  const lower = name.toLowerCase();
  return lower.includes("prototype") || lower.startsWith("mock");
};

const noPrototypeFolderRule = folderRule({
  description: "Disallow prototype and mock folders.",
  message:
    "Folder `{{folder}}` holds prototype or mock code on a production path. Put fakes in a simulated/ Data Source.",
  offendingFolder: (folders) => folders.find(isPrototypeName) ?? null,
});

const knownTopLevelRule = folderRule({
  description:
    "Allow only the layer folders and server/ at the top of the layer root.",
  message:
    "Top-level folder `{{folder}}` is not a layer. Use app or routes, composition, features, entities, modules, integrations, ui or server.",
  offendingFolder: ([top]) =>
    top !== undefined && !TOP_LEVEL_FOLDERS.has(top) ? top : null,
});

const compositionShapeRule = folderRule({
  description:
    "Allow only providers/, proxy/ and routing/ as first-level composition folders.",
  message:
    "Composition folder `{{folder}}` is not providers, proxy or routing. Put Shells and Page Templates in composition/routing/.",
  offendingFolder: ([top, first]) =>
    top === "composition" &&
    first !== undefined &&
    !COMPOSITION_FOLDERS.has(first)
      ? first
      : null,
});

const isShellLayout = (segments) =>
  segments.length === 5 &&
  segments[1] === "routing" &&
  segments[2] === "shells";

const layoutPlacementRule = folderRule({
  description:
    "Allow composition layout files only in composition/routing/shells/<name>/.",
  message:
    "Layout `{{folder}}` sits outside composition/routing/shells/<name>/. A layout belongs to one Shell folder.",
  offendingFolder: (folders, scope, { segments }) =>
    segments[0] === "composition" &&
    stem(segments.at(-1)) === "layout" &&
    !isShellLayout(segments)
      ? segments.join("/")
      : null,
});

// Domain names of one layer folder, read once per run.
const layerDomains = new Map();
const domainsOf = (layerFolder) => {
  if (!layerDomains.has(layerFolder)) {
    const names = isDirectory(layerFolder) ? readdirSync(layerFolder) : [];
    layerDomains.set(layerFolder, new Set(names.map(stem)));
  }
  return layerDomains.get(layerFolder);
};

const namePrefix = (name) => name.split("-")[0];

// A hyphenated domain repeats a prefix when a sibling shares the part before
// its first `-`, or when that part is itself a sibling domain.
const repeatsPrefix = (domain, siblings) =>
  domain.includes("-") &&
  [...siblings].some(
    (other) =>
      other !== domain &&
      (other === namePrefix(domain) ||
        (other.includes("-") && namePrefix(other) === namePrefix(domain)))
  );

const noPrefixSiblingsRule = folderRule({
  description:
    "Disallow sibling domains of one layer that repeat a name prefix.",
  message:
    "Domain `{{folder}}` repeats a sibling's name prefix. Use one domain folder with subpaths, such as candidate/cv/.",
  offendingFolder: (folders, scope, { domain, layer }) =>
    DOMAIN_LAYERS.has(layer) &&
    domain !== null &&
    repeatsPrefix(domain, domainsOf(path.join(scope.layerRoot, layer)))
      ? domain
      : null,
});

const uiPlacementRule = folderRule({
  description:
    "Disallow an app-local ui/ folder in a monorepo; primitives live in the shared UI package.",
  message:
    "App-local `{{folder}}/` is not allowed in a monorepo. Put primitives and shadcn components in the shared UI package.",
  offendingFolder: ([top], scope) =>
    top === "ui" && isMonorepo(scope.packageRoot) ? top : null,
});

export default definePlugin({
  meta: { name: "frontend-layers" },
  rules: {
    "composition-shape": compositionShapeRule,
    "data-source-imports": dataSourceImportsRule,
    "index-reexports-only": indexReexportsOnlyRule,
    "known-top-level": knownTopLevelRule,
    "layer-order": layerOrderRule,
    "layout-placement": layoutPlacementRule,
    "no-peer-entity": noPeerEntityRule,
    "no-peer-feature": noPeerFeatureRule,
    "no-prefix-siblings": noPrefixSiblingsRule,
    "no-prototype-folder": noPrototypeFolderRule,
    "no-self-index-import": noSelfIndexImportRule,
    "public-entrypoint": publicEntrypointRule,
    "route-imports": routeImportsRule,
    "server-contract-purity": serverContractPurityRule,
    "ui-placement": uiPlacementRule,
  },
});

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { decodeLines, stemOf, toEpochMs } from "./pi";
import { usageResult } from "./folders";
import { appDataFolders } from "./vscode";
import type { SourceFile } from "./pi";
import type { ReadResult, Reader, UsageRecord } from "./types";

const fileReadConcurrency = 8;

// --- Shared by the readers of jsonl logs below several folders -------------------------

/** The items of one log file, or none when the file is corrupt. */
export type ParseLog<A> = (file: SourceFile) => Option.Option<readonly A[]>;

/** What the jsonl files below some folders gave: the parsed items, and a cause per failure. */
export interface LogItems<A> {
  readonly items: readonly A[];
  readonly failures: readonly string[];
}

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** True when a file has lines and none of them is JSON. */
export const isCorrupt = (text: string): boolean => Option.isNone(decodeLines(text, decodeJson));

/**
 * Reads every wanted file below each folder in `roots`, at any depth, in folder order and then
 * file name order. A missing folder gives nothing. A folder that cannot be listed, a file that
 * cannot be read, and a file `parse` calls corrupt each add a failure; the others still count.
 */
export const readLogFiles = <A>(
  roots: readonly string[],
  wanted: (name: string) => boolean,
  parse: ParseLog<A>,
): Effect.Effect<LogItems<A>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* readRoots() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const items: A[] = [];
    const failures: string[] = [];

    const readOne = (root: string, name: string) =>
      Effect.gen(function* readOneFile() {
        const file = path.join(root, name);
        const text = yield* fs.readFileString(file);
        const info = yield* fs.stat(file);
        const mtime = Option.getOrElse(info.mtime, () => new Date());
        return { file, mtimeMs: mtime.getTime(), segments: name.split(path.sep), text };
      }).pipe(Effect.mapError((cause) => cause.message));

    for (const root of new Set(roots)) {
      if (!(yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false)))) {
        continue;
      }
      const listed = yield* Effect.result(fs.readDirectory(root, { recursive: true }));
      if (Result.isFailure(listed)) {
        failures.push(listed.failure.message);
        continue;
      }
      const [passes, fails] = yield* Effect.partition(
        listed.success.filter((name) => wanted(path.basename(name))).toSorted(),
        (name) => readOne(root, name),
        { concurrency: fileReadConcurrency },
      );
      failures.push(...fails);
      // Parsed one by one in path order, after the reads: a parser that keeps the first copy
      // of a call must see the files in the same order on every run.
      for (const { file, ...source } of passes) {
        const parsed = parse(source);
        if (Option.isSome(parsed)) {
          items.push(...parsed.value);
        } else {
          failures.push(`${file} could not be parsed`);
        }
      }
    }
    return { failures, items };
  });

// --- Claude Code transcripts -------------------------------------------------------------

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/**
 * The fields of one transcript line this reader needs. Lines of other types
 * (prompts, tool results) fail to decode and are skipped.
 */
const LogLine = Schema.Struct({
  message: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    model: Schema.String,
    usage: Schema.Struct({
      cache_creation_input_tokens: Schema.optionalKey(Count),
      cache_read_input_tokens: Schema.optionalKey(Count),
      input_tokens: Count,
      output_tokens: Count,
    }),
  }),
  requestId: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
});

/** A line that names the model a later `auto` line used: Qoder's `businessModelKey` or `runtime-config`. */
const ModelHintLine = Schema.Struct({
  businessModelKey: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(
    Schema.Struct({ businessModelKey: Schema.optionalKey(Schema.String) }),
  ),
  model: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
});

const decodeLogLine = Schema.decodeUnknownOption(Schema.fromJsonString(LogLine));
const decodeModelHintLine = Schema.decodeUnknownOption(Schema.fromJsonString(ModelHintLine));

const autoModel = "auto";

/** The concrete model a hint line names, if any. */
const modelHintOf = (line: string): string | undefined =>
  Option.toArray(decodeModelHintLine(line))
    .flatMap((hint) => [
      hint.businessModelKey,
      hint.message?.businessModelKey,
      hint.type === "runtime-config" ? hint.model : undefined,
    ])
    .find((model) => model !== undefined && model !== "" && model !== autoModel);

/** A usage record from the logs; `key` is set when the line has a message id to de-duplicate on. */
interface LoggedMessage {
  readonly key: string | undefined;
  readonly record: UsageRecord;
}

const parseTranscript =
  (sessionPrefix: string): ParseLog<LoggedMessage> =>
  (file) => {
    const fileSession = stemOf(file.segments, ".jsonl");
    const messages: LoggedMessage[] = [];
    let modelHint: string | undefined;
    for (const line of file.text.split("\n")) {
      // Cheap filters first: only lines that can hold usage or a model hint are parsed.
      if (line.includes('"businessModelKey"') || line.includes('"runtime-config"')) {
        modelHint = modelHintOf(line) ?? modelHint;
      }
      if (!line.includes('"usage"')) {
        continue;
      }
      for (const { message, requestId, sessionId, timestamp } of Option.toArray(
        decodeLogLine(line),
      )) {
        messages.push({
          // Newer Claude Code versions write no requestId, so the message id alone is the key.
          key: message.id === undefined ? undefined : `${message.id}:${requestId ?? ""}`,
          record: {
            at: toEpochMs(timestamp, file.mtimeMs),
            cacheRead: message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
            input: message.usage.input_tokens,
            model: message.model === autoModel ? (modelHint ?? autoModel) : message.model,
            output: message.usage.output_tokens,
            session: `${sessionPrefix}:${sessionId ?? fileSession}`,
          },
        });
      }
    }
    return messages.length === 0 && isCorrupt(file.text) ? Option.none() : Option.some(messages);
  };

/**
 * Keep one line per message. Claude Code writes a line for each content block of a message, and
 * the counts grow while it streams, so the last line of a `message.id` (+ `requestId`) is the
 * final one. Lines with no message id always count.
 */
const uniqueRecords = (messages: readonly LoggedMessage[]): UsageRecord[] => {
  const byKey = new Map<string, UsageRecord>();
  const records: UsageRecord[] = [];
  for (const { key, record } of messages) {
    if (key === undefined) {
      records.push(record);
    } else {
      byKey.set(key, record);
    }
  }
  return [...records, ...byKey.values()];
};

// `.checkpoints.jsonl` files (Qoder) hold snapshots of the same lines, not more calls.
const isTranscript = (name: string): boolean =>
  name.endsWith(".jsonl") && !name.endsWith(".checkpoints.jsonl");

/** Where one harness keeps Claude Code style transcripts. */
export interface TranscriptSource {
  /** Display name, for example "Claude Code". */
  readonly agent: string;
  /** Start of every session key, for example `claude` for `claude:<id>`. */
  readonly sessionPrefix: string;
  /** Folders whose `*.jsonl` files, at any depth, are transcripts. */
  readonly roots: readonly string[];
  /** The folder a `Skipped` result names. */
  readonly path: string;
}

/**
 * Reads Claude Code style transcripts: one jsonl line per content block of an assistant
 * message, with `message.model`, `message.id`, `message.usage` (`input_tokens` without cache,
 * `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`), `requestId`,
 * `sessionId` and `timestamp`. Every model call counts once over all roots, keyed on
 * `message.id` + `requestId` (see `uniqueRecords`). `session` = prefix + `sessionId`, else the
 * file name; `at` = `timestamp`, else the file time. A model of `auto` takes the last
 * concrete model the file named before it (`businessModelKey`, or a `runtime-config` line).
 *
 * A bad file is skipped, not fatal. The source is `Skipped` only when no usage is
 * left: `unreadable` if something failed to read, else `no-data`.
 */
export const readTranscripts = (
  source: TranscriptSource,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.map(
    readLogFiles(source.roots, isTranscript, parseTranscript(source.sessionPrefix)),
    ({ failures, items }) => usageResult(source.agent, source.path, uniqueRecords(items), failures),
  );

const desktopApps = ["Claude", "Claude-3p"];
const desktopSessionFolders = ["local-agent-mode-sessions", "claude-code-sessions"];

/**
 * The transcript folders of Claude Desktop's built-in Claude Code and Cowork sessions. Each
 * session keeps its own `.claude` folder somewhere below `<app data>/Claude/<sessions folder>`
 * (`Claude-3p` for third-party builds; on a Windows Store install, below
 * `AppData/Local/Packages/Claude_*`/`LocalCache/Roaming`). Only its `projects` and `transcripts`
 * folders are transcripts: `audit.jsonl` and `usage-ledger` hold copies of the same calls.
 */
const desktopTranscriptRoots = (home: string) =>
  Effect.gen(function* findDesktopRoots() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const listing = (folder: string, recursive: boolean) =>
      fs.readDirectory(folder, { recursive }).pipe(Effect.orElseSucceed((): string[] => []));

    const packages = path.join(home, "AppData", "Local", "Packages");
    const storeApps = (yield* listing(packages, false))
      .filter((name) => name.startsWith("Claude_") || name.includes(".Claude_"))
      .map((name) => path.join(packages, name, "LocalCache", "Roaming", "Claude"));
    const apps = [
      ...(yield* appDataFolders(home)).flatMap((folder) =>
        desktopApps.map((app) => path.join(folder, app)),
      ),
      ...storeApps,
    ];

    const roots: string[] = [];
    for (const base of apps.flatMap((app) =>
      desktopSessionFolders.map((folder) => path.join(app, folder)),
    )) {
      for (const name of yield* listing(base, true)) {
        const parts = name.split(path.sep);
        const last = parts.at(-1);
        if (parts.at(-2) === ".claude" && (last === "projects" || last === "transcripts")) {
          roots.push(path.join(base, name));
        }
      }
    }
    return roots;
  });

/**
 * Claude Code usage: the transcripts of every Claude Code config folder, plus Claude Desktop's.
 *
 * - Config folders: `CLAUDE_CONFIG_DIR` when set, else `~/.claude` and `~/.config/claude`
 *   (where some Claude Code versions keep it). `CLAUDE_CONFIG_DIR` may list several folders,
 *   separated by commas, as ccusage reads it; a leading `~` is the home folder.
 * - In each: `projects/` (one jsonl per session, sub-agents below it) and `transcripts/`
 *   (logs some wrappers write, same line format).
 * - Claude Desktop's Claude Code and Cowork sessions (see `desktopTranscriptRoots`).
 *
 * A message copied into several folders counts once (see `readTranscripts` for the mapping).
 * Claude Code keeps 30 days of logs by default, the same window the Usage Summary covers.
 */
export const readClaude: Reader = (home) =>
  Effect.gen(function* readClaudeUsage() {
    const path = yield* Path.Path;
    const configured = (yield* environmentFolder("CLAUDE_CONFIG_DIR")).pipe(
      Option.map((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry !== "")
          .map((entry) =>
            entry === "~" || entry.startsWith("~/") ? path.join(home, entry.slice(1)) : entry,
          ),
      ),
      Option.filter((folders) => folders.length > 0),
    );
    const configFolders = Option.getOrElse(configured, () => [
      path.join(home, ".claude"),
      path.join(home, ".config", "claude"),
    ]);
    const desktopRoots = yield* desktopTranscriptRoots(home);
    return yield* readTranscripts({
      agent: "Claude Code",
      path: configFolders[0] ?? path.join(home, ".claude"),
      roots: [
        ...configFolders.flatMap((folder) => [
          path.join(folder, "projects"),
          path.join(folder, "transcripts"),
        ]),
        ...desktopRoots,
      ],
      sessionPrefix: "claude",
    });
  });

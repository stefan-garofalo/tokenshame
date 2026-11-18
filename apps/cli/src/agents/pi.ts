import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ReadResult, Reader, SkippedSource, UsageRecord } from "./types";

// Shared by the seven JSON agent readers (Pi, Gemini CLI, Grok, Qwen, Amp, Droid, Kimi).
// Kept in this file so the task adds no extra module.

/** Model id for usage that names no model. The server maps it to the unnamed bucket. */
export const unknownModel = "unknown";

/** A file a reader asked for: its path below the source folder, its text, and its last change. */
export interface SourceFile {
  /** Path segments below the source folder, for example `["project", "session.jsonl"]`. */
  readonly segments: readonly string[];
  readonly text: string;
  readonly mtimeMs: number;
}

/** The usage records of one file, or none when the file is corrupt. */
export type ParseFile = (file: SourceFile) => Option.Option<readonly UsageRecord[]>;

/** A token count from a log: non-negative and whole, as `UsageRecord` requires. */
export const toCount = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? 0
    : Math.min(Math.max(Math.trunc(value), 0), Number.MAX_SAFE_INTEGER);

/** Epoch milliseconds of an ISO timestamp, or the fallback when it is missing or invalid. */
export const toEpochMs = (iso: string | undefined, fallbackMs: number): number => {
  const parsed = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

/** The part of a count that remains once a subset the same count already includes is taken out. */
export const exclusive = (inclusive: number, subset: number): number =>
  subset <= inclusive ? inclusive - subset : inclusive;

/** The last path segment without its suffix: the session id of a log named after its session. */
export const stemOf = (segments: readonly string[], suffix: string): string => {
  const name = segments.at(-1) ?? "";
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
};

/**
 * Decodes each non-blank line of a jsonl file and keeps the lines that decode.
 * Returns none when the file has lines and none decode: the file is corrupt.
 */
export const decodeLines = <A>(
  text: string,
  decode: (line: string) => Option.Option<A>,
): Option.Option<readonly A[]> => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const decoded = lines.flatMap((line) => Option.toArray(decode(line)));
  return lines.length > 0 && decoded.length === 0 ? Option.none() : Option.some(decoded);
};

const hasTokens = (record: UsageRecord): boolean =>
  record.input + record.output + record.cacheRead + record.cacheWrite > 0;

/**
 * Reads every wanted file below `home/rootParts` and gathers their usage records.
 *
 * - The folder is missing, or holds no usage: `Skipped` with `no-data`.
 * - Files exist and none could be read or parsed: `Skipped` with `unreadable`.
 * - Otherwise the records of the files that parsed. A corrupt file is dropped; it never throws.
 */
export const readFiles = (
  agent: string,
  home: string,
  rootParts: readonly string[],
  wanted: (segments: readonly string[]) => boolean,
  parse: ParseFile,
): Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* gatherSource() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.join(home, ...rootParts);
    const skipped = (reason: SkippedSource["reason"], detail: string): SkippedSource => ({
      _tag: "Skipped",
      agent,
      detail,
      path: root,
      reason,
    });

    const readOne = (segments: readonly string[]) =>
      Effect.gen(function* readOneFile() {
        const file = path.join(root, ...segments);
        const text = yield* fs.readFileString(file);
        const info = yield* fs.stat(file);
        const mtime = Option.getOrElse(info.mtime, () => new Date());
        return parse({ mtimeMs: mtime.getTime(), segments, text });
      }).pipe(Effect.orElseSucceed(() => Option.none()));

    const collect = (entries: readonly string[]) =>
      Effect.gen(function* collectRecords() {
        const files = entries.map((entry) => entry.split(path.sep)).filter(wanted);
        // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
        // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
        const parsed = yield* Effect.forEach(files, readOne, { concurrency: 8 });
        const records = parsed
          .flatMap((fileRecords) => Option.getOrElse(fileRecords, () => []))
          .filter(hasTokens);
        if (records.length > 0) {
          return { _tag: "Read", records } as const;
        }
        const corrupt = parsed.filter(Option.isNone).length;
        return corrupt > 0
          ? skipped("unreadable", `${corrupt} of ${files.length} files could not be parsed`)
          : skipped("no-data", "");
      });

    const present = yield* fs.exists(root).pipe(Effect.orElseSucceed(() => false));
    if (!present) {
      return skipped("no-data", "");
    }
    return yield* fs.readDirectory(root, { recursive: true }).pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.succeed(skipped("unreadable", error.message)),
        onSuccess: collect,
      }),
    );
  });

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const PiLine = Schema.Struct({
  message: Schema.optionalKey(
    Schema.Struct({
      model: Text,
      role: Text,
      usage: Schema.optionalKey(
        Schema.Struct({ cacheRead: Count, cacheWrite: Count, input: Count, output: Count }),
      ),
    }),
  ),
  timestamp: Text,
});

const decodePiLine = Schema.decodeUnknownOption(Schema.fromJsonString(PiLine));

const parsePi: ParseFile = (file) => {
  const session = `pi:${stemOf(file.segments, ".jsonl")}`;
  return Option.map(decodeLines(file.text, decodePiLine), (lines) =>
    lines.flatMap((line) => {
      const { message } = line;
      const usage = message?.usage;
      if (message?.role !== "assistant" || usage === undefined) {
        return [];
      }
      return [
        {
          at: toEpochMs(line.timestamp, file.mtimeMs),
          cacheRead: toCount(usage.cacheRead),
          cacheWrite: toCount(usage.cacheWrite),
          input: toCount(usage.input),
          model: message.model ?? unknownModel,
          output: toCount(usage.output),
          session,
        },
      ];
    }),
  );
};

/**
 * Pi (badlogic/pi-mono). Reads `~/.pi/agent/sessions/<project>/*.jsonl`, one session per file.
 * Each assistant `message` line carries `message.model` and `message.usage`:
 * `input`, `output`, `cacheRead`, `cacheWrite` map to the same-named record fields
 * (Pi already keeps cache out of `input`). `at` is the line's `timestamp`.
 * Other lines, including `compaction` usage, are ignored.
 */
export const readPi: Reader = (home) =>
  readFiles(
    "Pi",
    home,
    [".pi", "agent", "sessions"],
    (segments) => segments.length >= 2 && segments.at(-1)?.endsWith(".jsonl") === true,
    parsePi,
  );

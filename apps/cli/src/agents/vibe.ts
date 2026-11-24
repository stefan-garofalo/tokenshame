import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { hasTokens, readFiles, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { ReadResult, Reader, SkippedSource, UsageRecord } from "./types";

const agent = "Mistral Vibe";

// --- Session logs of Vibe 1.x and 2.x: `meta.json` holds the session's running totals ---

const Meta = Schema.Struct({
  active_model: NullableText,
  config: Schema.optionalKey(Schema.NullOr(Schema.Struct({ active_model: NullableText }))),
  end_time: NullableText,
  model: NullableText,
  session_id: NullableText,
  start_time: NullableText,
  stats: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        session_cached_tokens: NullableCount,
        session_completion_tokens: NullableCount,
        session_prompt_tokens: NullableCount,
      }),
    ),
  ),
});

// Vibe 1.x wraps the same fields in `metadata`.
const SessionFile = Schema.Struct({
  ...Meta.fields,
  metadata: Schema.optionalKey(Schema.NullOr(Meta)),
});

const decodeSessionFile = Schema.decodeUnknownOption(Schema.fromJsonString(SessionFile));

/** The pinned model; an empty pin means "the configured default", which the log does not name. */
const pinnedModel = (meta: typeof Meta.Type): string =>
  [meta.config?.active_model, meta.active_model, meta.model]
    .map((model) => model?.trim() ?? "")
    .find((model) => model !== "") ?? unknownModel;

const parseMeta: ParseFile = (file) =>
  Option.map(decodeSessionFile(file.text), (root) => {
    const meta = root.metadata ?? root;
    const { stats } = meta;
    if (stats === null || stats === undefined) {
      return [];
    }
    // `session_prompt_tokens` includes the cached prompt tokens.
    const prompt = countOf(stats.session_prompt_tokens);
    const cached = Math.min(countOf(stats.session_cached_tokens), prompt);
    const name = file.segments.at(-1) === "meta.json" ? file.segments.at(-2) : file.segments.at(-1);
    return [
      {
        at: timeOf(meta.end_time ?? meta.start_time, file.mtimeMs),
        cacheRead: cached,
        cacheWrite: 0,
        input: prompt - cached,
        model: pinnedModel(meta),
        output: countOf(stats.session_completion_tokens),
        session: `vibe:${meta.session_id ?? name ?? ""}`,
      },
    ];
  });

/** `<session>/meta.json`, a sub-agent's `<session>/agents/<agent>/meta.json`, or a 1.x `<prefix>_<id>.json`. */
const isSessionLog = (segments: readonly string[]): boolean => {
  const name = segments.at(-1) ?? "";
  return (
    (segments.length === 2 && name === "meta.json") ||
    (segments.length === 4 && segments[1] === "agents" && name === "meta.json") ||
    (segments.length === 1 && name.endsWith(".json") && !name.startsWith("."))
  );
};

// --- Unified sessions of Vibe 2.25+: `unified/<session>/`, cumulative usage in snapshots ---

const TokenUsage = Schema.Struct({
  cachedInputTokens: NullableCount,
  inputTokens: NullableCount,
  outputTokens: NullableCount,
});

/** A projection state: the session's cumulative `tokenUsage` and when it last changed. */
const State = Schema.optionalKey(
  Schema.NullOr(
    Schema.Struct({
      session: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            tokenUsage: Schema.optionalKey(Schema.NullOr(TokenUsage)),
            updatedAt: NullableCount,
          }),
        ),
      ),
    }),
  ),
);

const Current = Schema.Struct({
  generation: Schema.String.check(Schema.isPattern(/^\d{16}$/u)),
  session_id: NullableText,
});
const Projection = Schema.Struct({ snapshot: State, snapshot_sequence: NullableCount });
const Runtime = Schema.Struct({
  session_metadata: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ active_model: NullableText })),
  ),
});
const JournalRecord = Schema.Struct({
  payload: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        delta: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
        snapshot: State,
      }),
    ),
  ),
  sequence: NullableCount,
  type: NullableText,
});
const DeltaOp = Schema.Struct({ op: NullableText, state: State });

const decodeCurrent = Schema.decodeUnknownOption(Schema.fromJsonString(Current));
const decodeProjection = Schema.decodeUnknownOption(Schema.fromJsonString(Projection));
const decodeRuntime = Schema.decodeUnknownOption(Schema.fromJsonString(Runtime));
const decodeMeta = Schema.decodeUnknownOption(Schema.fromJsonString(Meta));
const decodeJournalRecord = Schema.decodeUnknownOption(Schema.fromJsonString(JournalRecord));
const decodeDeltaOp = Schema.decodeUnknownOption(DeltaOp);

type StateValue = (typeof Projection.Type)["snapshot"];

/** One cumulative usage reading of a unified session, at a journal sequence. */
interface UsagePoint {
  readonly sequence: number;
  readonly input: number;
  readonly output: number;
  readonly cached: number;
  readonly updatedAt: number | null | undefined;
}

const pointOf = (sequence: number, state: StateValue): UsagePoint[] => {
  const usage = state?.session?.tokenUsage;
  if (usage === null || usage === undefined) {
    return [];
  }
  return [
    {
      cached: countOf(usage.cachedInputTokens),
      input: countOf(usage.inputTokens),
      output: countOf(usage.outputTokens),
      sequence,
      updatedAt: state?.session?.updatedAt,
    },
  ];
};

/** The usage readings of one journal segment: full snapshots and `set_envelope` deltas. */
const journalPoints = (text: string): UsagePoint[] =>
  text.split("\n").flatMap((line) =>
    Option.match(decodeJournalRecord(line), {
      onNone: () => [],
      onSome: (record) => {
        const sequence = countOf(record.sequence);
        const { payload } = record;
        if (record.type === "projection_advanced") {
          return pointOf(sequence, payload?.snapshot);
        }
        return (payload?.delta ?? []).flatMap((raw) =>
          Option.match(decodeDeltaOp(raw), {
            onNone: () => [],
            onSome: (op) => (op.op === "set_envelope" ? pointOf(sequence, op.state) : []),
          }),
        );
      },
    }),
  );

/**
 * The session's latest total. Readings are cumulative, so the last one by sequence is the
 * total; a reading lower than an earlier one is a stale replay and is passed over.
 */
const latestPoint = (points: readonly UsagePoint[]): UsagePoint | undefined => {
  let latest: UsagePoint | undefined;
  for (const point of points.toSorted((a, b) => a.sequence - b.sequence)) {
    if (latest === undefined || (point.input >= latest.input && point.output >= latest.output)) {
      latest = point;
    }
  }
  return latest;
};

/** The runtime's pinned model, else the pin `meta.json` keeps, else unknown. */
const unifiedModel = (pinned: string, meta: typeof Meta.Type | undefined): string => {
  if (pinned !== "") {
    return pinned;
  }
  return meta === undefined ? unknownModel : pinnedModel(meta);
};

/** The usage of one unified session folder; none when its `CURRENT` or projection is corrupt. */
const readUnifiedSession = (dir: string) =>
  Effect.gen(function* readSession() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const read = <A>(decode: (text: string) => Option.Option<A>, ...parts: readonly string[]) =>
      fs.readFileString(path.join(dir, ...parts)).pipe(
        Effect.map(decode),
        Effect.orElseSucceed(() => Option.none<A>()),
      );
    const current = yield* read(decodeCurrent, "CURRENT");
    if (Option.isNone(current)) {
      return Option.none<readonly UsageRecord[]>();
    }
    const generation = ["generations", current.value.generation];
    const projection = yield* read(decodeProjection, ...generation, "projection-state.json");
    if (Option.isNone(projection)) {
      return Option.none<readonly UsageRecord[]>();
    }
    const points = pointOf(countOf(projection.value.snapshot_sequence), projection.value.snapshot);
    const journal = yield* fs
      .readDirectory(path.join(dir, "journal"))
      .pipe(Effect.orElseSucceed((): string[] => []));
    for (const name of journal.filter((entry) => entry.endsWith(".jsonl"))) {
      const segment = yield* read((text) => Option.some(journalPoints(text)), "journal", name);
      points.push(...Option.getOrElse(segment, (): UsagePoint[] => []));
    }
    const latest = latestPoint(points);
    if (latest === undefined) {
      return Option.some<readonly UsageRecord[]>([]);
    }
    const runtime = yield* read(decodeRuntime, ...generation, "runtime-state.json");
    const meta = Option.getOrUndefined(yield* read(decodeMeta, "meta.json"));
    const pinned = Option.getOrUndefined(runtime)?.session_metadata?.active_model?.trim() ?? "";
    const currentMs = yield* fs.stat(path.join(dir, "CURRENT")).pipe(
      Effect.map((info) => Option.getOrElse(info.mtime, () => new Date()).getTime()),
      Effect.orElseSucceed(() => Date.now()),
    );
    const cached = Math.min(latest.cached, latest.input);
    return Option.some<readonly UsageRecord[]>([
      {
        at: timeOf(latest.updatedAt, timeOf(meta?.end_time ?? meta?.start_time, currentMs)),
        cacheRead: cached,
        cacheWrite: 0,
        input: latest.input - cached,
        model: unifiedModel(pinned, meta),
        output: latest.output,
        session: `vibe:${current.value.session_id ?? path.basename(dir)}`,
      },
    ]);
  });

/** Every unified session below `root/unified`, and how many were corrupt. */
const readUnified = (root: string) =>
  Effect.gen(function* readUnifiedSessions() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const unified = path.join(root, "unified");
    const entries = yield* fs.readDirectory(unified).pipe(Effect.orElseSucceed((): string[] => []));
    const records: UsageRecord[] = [];
    let corrupt = 0;
    for (const entry of entries) {
      const dir = path.join(unified, entry);
      const hasCurrent = yield* fs
        .exists(path.join(dir, "CURRENT"))
        .pipe(Effect.orElseSucceed(() => false));
      if (hasCurrent) {
        const session = yield* readUnifiedSession(dir);
        if (Option.isSome(session)) {
          records.push(...session.value);
        } else {
          corrupt += 1;
        }
      }
    }
    return { corrupt, records };
  });

/**
 * Mistral Vibe. Reads `<vibe>/logs/session/`, where `<vibe>` is `VIBE_HOME` when set, else
 * `~/.vibe` (the same on every platform). Vibe keeps only running totals per session, so each
 * session gives one record; `at` is its end time and `model` its pinned model (an unpinned
 * session runs a default the log does not name: unknown). Sub-agents are their own sessions.
 *
 * - Vibe 2.x `<session>/meta.json` (and a sub-agent's `<session>/agents/<agent>/meta.json`) and
 *   Vibe 1.x `<prefix>_<id>.json` (fields under `metadata`): `stats.session_prompt_tokens`
 *   includes `session_cached_tokens`, so `input` = prompt - cached and `cacheRead` = cached;
 *   `output` = `session_completion_tokens`. `model` = `config.active_model`; `at` = `end_time`,
 *   else `start_time`, else the file time; `session` = `vibe:` + `session_id`.
 * - Vibe 2.25+ `unified/<session>/`: `CURRENT` names the committed generation. The session's
 *   cumulative `session.tokenUsage` is read from that generation's `projection-state.json`
 *   and from the newer readings in `journal/*.jsonl` (`projection_advanced` snapshots and
 *   `set_envelope` deltas); the latest reading is the total. `inputTokens` includes
 *   `cachedInputTokens`, so `input` = input - cached and `cacheRead` = cached. `model` =
 *   `runtime-state.json` `session_metadata.active_model`; `at` = `session.updatedAt` (epoch ms).
 *   `contextUsage` (the current context window) is not usage and is not read. When a session id
 *   has a unified folder, its older `meta.json` totals are not counted again.
 */
export const readVibe: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const vibeHome = yield* environmentFolder("VIBE_HOME");
    const root = path.join(
      Option.getOrElse(vibeHome, () => path.join(home, ".vibe")),
      "logs",
      "session",
    );
    const legacy = yield* readFiles(agent, root, [], isSessionLog, parseMeta);
    const unified = yield* readUnified(root);
    const unifiedSessions = new Set(unified.records.map((record) => record.session));
    const records = [
      ...(legacy._tag === "Read" ? legacy.records : []).filter(
        (record) => !unifiedSessions.has(record.session),
      ),
      ...unified.records.filter(hasTokens),
    ];
    if (records.length > 0) {
      return { _tag: "Read", records } satisfies ReadResult;
    }
    if (legacy._tag === "Skipped" && (legacy.reason === "unreadable" || unified.corrupt === 0)) {
      return legacy;
    }
    return {
      _tag: "Skipped",
      agent,
      detail: `${unified.corrupt} unified sessions could not be parsed`,
      path: root,
      reason: "unreadable",
    } satisfies SkippedSource;
  });

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { decodeLines, readFiles, toCount } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);

/** The part of a Muse `session.jsonl` line that a usage event has. Other lines do not match. */
const UsageEvent = Schema.Struct({
  id: Schema.NonEmptyString,
  payload: Schema.Struct({
    event: Schema.Struct({
      kind: Schema.Literals(["model_completed", "automated_review_completed"]),
      model: Schema.Union([
        Schema.NonEmptyString,
        Schema.Struct({ model_id: Schema.NonEmptyString }),
      ]),
      usage: Schema.Struct({
        cache_read_tokens: Count,
        cache_write_tokens: Count,
        cached_input_tokens: Count,
        cached_tokens: Count,
        input_tokens: Count,
        output_tokens: Count,
      }),
    }),
    source_run_record_id: Schema.optionalKey(Schema.NonEmptyString),
  }),
  recorded_at: Schema.Finite,
  stream: Schema.Struct({ id: Schema.NonEmptyString }),
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeUsageEvent = Schema.decodeUnknownOption(UsageEvent);

const microsecondsPerMillisecond = 1000;

const toRecord = (event: typeof UsageEvent.Type): UsageRecord => {
  const { model, usage } = event.payload.event;
  // Muse counts cache inside `input_tokens`: read and write are parts of it.
  const input = toCount(usage.input_tokens);
  const cacheRead = Math.min(
    input,
    toCount(usage.cache_read_tokens ?? usage.cached_input_tokens ?? usage.cached_tokens),
  );
  const cacheWrite = Math.min(input - cacheRead, toCount(usage.cache_write_tokens));
  return {
    at: Math.trunc(event.recorded_at / microsecondsPerMillisecond),
    cacheRead,
    cacheWrite,
    input: input - cacheRead - cacheWrite,
    model: Predicate.isString(model) ? model : model.model_id,
    output: toCount(usage.output_tokens),
    session: `muse:${event.stream.id}`,
  };
};

/**
 * A parser for one run of the reader. Muse copies a session's records into a forked or
 * resumed session; the source record id (else the line id) names one model call, so a call
 * is counted once, in whichever file is read first.
 */
const makeParse = (): ParseFile => {
  const seen = new Set<string>();
  return (file) =>
    Option.map(
      decodeLines(file.text, (line) =>
        Option.map(decodeJson(line), (json) =>
          Option.match(decodeUsageEvent(json), {
            onNone: () => [],
            onSome: (event) => {
              const key = event.payload.source_run_record_id ?? event.id;
              if (seen.has(key)) {
                return [];
              }
              seen.add(key);
              return [toRecord(event)];
            },
          }),
        ),
      ),
      (lines) => lines.flat(),
    );
};

const environmentFolder = (name: string) =>
  Config.option(Config.NonEmptyString(name)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/**
 * Muse (Meta's Muse Code CLI) keeps one event log per session, `<home>/sessions/YYYY/MM/DD/<id>/session.jsonl`,
 * with sub-agent logs in `subagent/<id>/` below it. The folder is, in order:
 * - `MUSE_HOME`, when set;
 * - `$XDG_DATA_HOME/muse`, when set;
 * - the default `~/.local/share/muse` (the same on every platform).
 * Never starts Muse: the reader only lists and reads files. T3 Code asks a running Muse for
 * this folder; the default was taken from independent readers of Muse's logs (CodexBar,
 * relayhistory, tokscale, ccmux), since Meta documents no folder.
 *
 * A missing folder is `no-data`. Mapping, from lines of kind `model_completed` and
 * `automated_review_completed` only: `model` = `payload.event.model` (text or
 * `model_id`), `session` = `muse:` + `stream.id`, `at` = `recorded_at` (microseconds).
 * Muse counts cache inside `usage.input_tokens` (read: `cache_read_tokens`, `cached_input_tokens`
 * or `cached_tokens`, write: `cache_write_tokens`), so `input` = `input_tokens` - cache
 * reads - cache writes. `output` = `output_tokens`; `reasoning_tokens` is part of it.
 */
export const readMuse: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const museHome = yield* environmentFolder("MUSE_HOME");
    const dataHome = yield* environmentFolder("XDG_DATA_HOME");
    const folder = Option.getOrElse(museHome, () =>
      Option.match(dataHome, {
        onNone: () => path.join(home, ".local", "share", "muse"),
        onSome: (data) => path.join(data, "muse"),
      }),
    );
    return yield* readFiles(
      "Muse",
      folder,
      ["sessions"],
      (segments) => segments.at(-1) === "session.jsonl",
      makeParse(),
    );
  });

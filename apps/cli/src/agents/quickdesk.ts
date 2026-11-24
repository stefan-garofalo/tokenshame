import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { decodeLines, readFiles, toCount } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** One usage line of a metrics file (AWS Embedded Metric Format). Other lines do not match. */
const MetricsLine = Schema.Struct({
  InputTokens: Count,
  Model: Schema.NonEmptyString,
  OutputTokens: Count,
  _aws: Schema.optionalKey(Schema.Struct({ Timestamp: Schema.optionalKey(Schema.Finite) })),
  session_id: Schema.optionalKey(Schema.String),
});

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeMetricsLine = Schema.decodeUnknownOption(MetricsLine);

const metricsFile = /^metrics-(?<date>\d{4}-\d{2}-\d{2})\.jsonl$/u;

const parseMetrics: ParseFile = (file) => {
  const name = file.segments.at(-1) ?? "";
  const day = Date.parse(`${metricsFile.exec(name)?.groups?.date ?? ""}T00:00:00Z`);
  const dayMs = Number.isFinite(day) ? day : file.mtimeMs;
  return Option.map(
    decodeLines(file.text, (line) =>
      Option.map(decodeLine(line), (json) => Option.toArray(decodeMetricsLine(json))),
    ),
    (lines) =>
      lines.flat().map((line) => ({
        at: Math.trunc(line._aws?.Timestamp ?? dayMs),
        cacheRead: 0,
        cacheWrite: 0,
        input: toCount(line.InputTokens),
        model: line.Model,
        output: toCount(line.OutputTokens),
        session: `quickdesk:${line.session_id === undefined || line.session_id === "" ? file.segments.join("/") : line.session_id}`,
      })),
  );
};

/**
 * Quick Desktop (Amazon Quick, formerly Quickwork) keeps one metrics file per day,
 * `metrics/metrics-YYYY-MM-DD.jsonl`, below its store `QUICKWORK_HOME`, else `~/.quickwork`,
 * and below each profile folder inside it. A profile kept outside the store is not read.
 * The format is not documented; it was taken from codeburn's reader.
 *
 * Mapping, from lines with `Model`, `InputTokens` and `OutputTokens` only: `session` =
 * `quickdesk:` + `session_id` (else the file), `at` = `_aws.Timestamp` (epoch milliseconds,
 * else the file's day). The file names no cache counts, so `cacheRead` and `cacheWrite` are 0.
 */
export const readQuickDesk: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const store = Option.getOrElse(yield* environmentFolder("QUICKWORK_HOME"), () =>
      path.join(home, ".quickwork"),
    );
    return yield* readFiles(
      "Quick Desktop",
      store,
      [],
      (segments) => segments.at(-2) === "metrics" && metricsFile.test(segments.at(-1) ?? ""),
      parseMetrics,
    );
  });

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { decodeLines, readFiles, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const AsideLine = Schema.Struct({
  model: NullableText,
  responseId: NullableText,
  role: NullableText,
  timestamp: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite]))),
  usage: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        cacheRead: NullableCount,
        cacheWrite: NullableCount,
        input: NullableCount,
        output: NullableCount,
      }),
    ),
  ),
});

const decodeAsideLine = Schema.decodeUnknownOption(Schema.fromJsonString(AsideLine));

// Segments below `u`: `<account>/sessions/<session>/messages.jsonl`.
const parseAside: ParseFile = (file) => {
  const [account = "", , chat = ""] = file.segments;
  const session = `aside:${account}/${chat}`;
  return Option.map(decodeLines(file.text, decodeAsideLine), (lines) => {
    // A response id is one model call; if a line repeats it, the last copy wins.
    const byResponse = new Map<string, UsageRecord>();
    for (const [index, line] of lines.entries()) {
      const { usage } = line;
      if (line.role === "assistant" && usage !== null && usage !== undefined) {
        byResponse.set(line.responseId ?? `#${index}`, {
          at: timeOf(line.timestamp, file.mtimeMs),
          cacheRead: countOf(usage.cacheRead),
          cacheWrite: countOf(usage.cacheWrite),
          input: countOf(usage.input),
          model: line.model ?? unknownModel,
          output: countOf(usage.output),
          session,
        });
      }
    }
    return [...byResponse.values()];
  });
};

/**
 * Aside. Reads `~/.aside/u/<account>/sessions/<session>/messages.jsonl` (the same on every
 * platform), one session per folder; other files below a session (`artifacts/`, `tmp/`) are
 * not read. Each `assistant` line with `usage` gives one record: `usage.input`, `output`,
 * `cacheRead`, `cacheWrite` map to the same-named fields (Aside keeps cache out of `input`,
 * and `output` already holds `usage.reasoning`, which is not added). `model` = the line's
 * `model` as logged. `session` = `aside:` + account + `/` + session folder. `at` = the line's
 * `timestamp` (ISO text or epoch number), else the file time. A `responseId` counts once.
 */
export const readAside: Reader = (home) =>
  readFiles(
    "Aside",
    home,
    [".aside", "u"],
    (segments) =>
      segments.length === 4 && segments[1] === "sessions" && segments[3] === "messages.jsonl",
    parseAside,
  );

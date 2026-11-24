import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readFolders } from "./folders";
import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { countOnce, decodeLines, piCalls, stemOf, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Time = Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.String, Schema.Finite])));

/** A line of a legacy Claude Agent SDK transcript (`sdk-config/projects`). */
const SdkLine = Schema.Struct({
  _createdAt: Time,
  message: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        id: NullableText,
        model: NullableText,
        usage: Schema.optionalKey(
          Schema.NullOr(
            Schema.Struct({
              cache_creation_input_tokens: NullableCount,
              cache_read_input_tokens: NullableCount,
              input_tokens: NullableCount,
              output_tokens: NullableCount,
            }),
          ),
        ),
      }),
    ),
  ),
  sessionId: NullableText,
  session_id: NullableText,
  timestamp: Time,
  type: NullableText,
});

const decodeSdkLine = Schema.decodeUnknownOption(Schema.fromJsonString(SdkLine));

/** A record and the response id that names its model call, when the line has one. */
interface SdkRecord {
  readonly id: string | undefined;
  readonly record: UsageRecord;
}

const sdkRecords = (text: string, fileSession: string, mtimeMs: number) =>
  Option.map(decodeLines(text, decodeSdkLine), (lines) =>
    lines.flatMap((line): SdkRecord[] => {
      const { message } = line;
      const usage = message?.usage;
      if (line.type !== "assistant" || message?.model === "<synthetic>") {
        return [];
      }
      if (message === null || message === undefined || usage === null || usage === undefined) {
        return [];
      }
      const record: UsageRecord = {
        at: timeOf(line._createdAt ?? line.timestamp, mtimeMs),
        cacheRead: countOf(usage.cache_read_input_tokens),
        cacheWrite: countOf(usage.cache_creation_input_tokens),
        input: countOf(usage.input_tokens),
        model: message.model ?? unknownModel,
        output: countOf(usage.output_tokens),
        session: `proma:${line.session_id ?? line.sessionId ?? fileSession}`,
      };
      return [{ id: message.id ?? undefined, record }];
    }),
  );

/**
 * A parser for one run of the reader; the folders are read native first, display journal last.
 * - Native Pi sessions: a call a fork copied is counted once (see `piSessionParser`).
 * - Claude SDK lines: Claude writes a line per streamed snapshot of a response, so the last
 *   line of a response id is its final count. A fork or the display journal copies earlier
 *   responses, so a response id is counted once, in the first file read.
 * - A display line with no response id mirrors a native Pi call: it is skipped when its
 *   session was read natively, and kept when the journal is the only copy.
 */
const makeParse = (): ParseFile => {
  const seenPiCalls = new Set<string>();
  const piSessions = new Set<string>();
  const seenResponses = new Set<string>();
  return (file) => {
    if (file.segments[0] === "sessions") {
      return Option.map(piCalls("proma", file), (calls) => {
        for (const { record } of calls) {
          piSessions.add(record.session);
        }
        return countOnce(seenPiCalls, calls);
      });
    }
    const display = file.segments.length === 1;
    return Option.map(
      sdkRecords(file.text, stemOf(file.segments, ".jsonl"), file.mtimeMs),
      (entries) => {
        const byId = new Map<string, UsageRecord>();
        const anonymous: UsageRecord[] = [];
        for (const { id, record } of entries) {
          if (id === undefined) {
            if (!display || !piSessions.has(record.session)) {
              anonymous.push(record);
            }
          } else if (!seenResponses.has(id)) {
            byId.set(id, record);
          }
        }
        for (const id of byId.keys()) {
          seenResponses.add(id);
        }
        return [...anonymous, ...byId.values()];
      },
    );
  };
};

const isLog = (segments: readonly string[]): boolean =>
  segments.at(-1)?.endsWith(".jsonl") === true &&
  (segments.length === 1 ||
    ((segments[0] === "sessions" || segments[0] === "projects") && segments.length >= 2));

/**
 * Proma (proma-ai/Proma) Agent mode. Reads `~/.proma` and, for development builds,
 * `~/.proma-dev` (the same on every platform):
 * - `sdk-config/sessions/**\/*.jsonl`: native Pi sessions, read as Pi's format (`input`,
 *   `output`, `cacheRead`, `cacheWrite`; cache is kept out of `input`, `output` already holds
 *   reasoning). `session` = `proma:` + the `session` line id, else the file name.
 * - `sdk-config/projects/**\/*.jsonl`: legacy Claude Agent SDK transcripts. Each `assistant`
 *   line maps `message.usage` `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
 *   `cache_creation_input_tokens` to `input`, `output`, `cacheRead`, `cacheWrite`. `result`
 *   lines (turn totals) and the `<synthetic>` model are skipped. `at` = `_createdAt`, else
 *   `timestamp`, else the file time; `session` = `proma:` + `session_id`, else the file name.
 * - `agent-sessions/*.jsonl`: Proma's display journal, in the Claude SDK line format. It
 *   copies the calls above, so it only adds calls no native file holds (see `makeParse`).
 */
export const readProma: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = (...parts: readonly string[]) => path.join(home, ...parts);
    return yield* readFolders(
      "Proma",
      [
        folder(".proma", "sdk-config"),
        folder(".proma-dev", "sdk-config"),
        folder(".proma", "agent-sessions"),
        folder(".proma-dev", "agent-sessions"),
      ],
      isLog,
      makeParse(),
    );
  });

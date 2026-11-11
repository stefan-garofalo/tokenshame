import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { decodeLines, exclusive, readFiles, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile, SourceFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const GeminiMessageSchema = Schema.Struct({
  id: Text,
  model: Text,
  timestamp: Text,
  tokens: Schema.optionalKey(
    Schema.Struct({ cached: Count, input: Count, output: Count, thoughts: Count, tool: Count }),
  ),
  type: Text,
});
type GeminiMessage = typeof GeminiMessageSchema.Type;

const GeminiSession = Schema.Struct({
  messages: Schema.optionalKey(Schema.Array(GeminiMessageSchema)),
});

const decodeSession = Schema.decodeUnknownOption(Schema.fromJsonString(GeminiSession));
const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(GeminiMessageSchema));

const toRecords = (
  messages: readonly GeminiMessage[],
  session: string,
  file: SourceFile,
): readonly UsageRecord[] => {
  // A recording can rewrite a message under the same id as it streams: the last copy wins.
  const byId = new Map<string, UsageRecord>();
  for (const [index, message] of messages.entries()) {
    const { tokens } = message;
    if (message.type === "gemini" && tokens !== undefined) {
      const cached = toCount(tokens.cached);
      byId.set(message.id ?? `#${index}`, {
        at: toEpochMs(message.timestamp, file.mtimeMs),
        cacheRead: cached,
        cacheWrite: 0,
        input: exclusive(toCount(tokens.input), cached) + toCount(tokens.tool),
        model: message.model ?? unknownModel,
        output: toCount(tokens.output) + toCount(tokens.thoughts),
        session,
      });
    }
  }
  return [...byId.values()];
};

const parseGemini: ParseFile = (file) => {
  const isJsonl = file.segments.at(-1)?.endsWith(".jsonl") === true;
  const session = `gemini:${stemOf(file.segments, isJsonl ? ".jsonl" : ".json")}`;
  const recordsOf = (found: readonly GeminiMessage[]) => toRecords(found, session, file);
  if (isJsonl) {
    return Option.map(decodeLines(file.text, decodeMessage), recordsOf);
  }
  return Option.map(decodeSession(file.text), (decoded) => recordsOf(decoded.messages ?? []));
};

/**
 * Gemini CLI. Reads the chat recordings `~/.gemini/tmp/<project hash>/chats/*.json`
 * (one JSON document with `messages`) and `*.jsonl` (one message per line), one session
 * per file. Each `gemini` message carries `model` and `tokens`:
 * `input` is the whole prompt with `cached` inside it, so `input` = `input` - `cached`
 * + `tool` (tool-use prompt), `cacheRead` = `cached`, `output` = `output` + `thoughts`
 * (thinking is billed as output). `at` is the message `timestamp`.
 * `~/.gemini/tmp/<hash>/logs.json` holds user prompts only, with no tokens, so it is not read.
 * Gemini CLI telemetry is off by default and is not read.
 */
export const readGemini: Reader = (home) =>
  readFiles(
    "Gemini CLI",
    home,
    [".gemini", "tmp"],
    (segments) =>
      segments.length >= 3 &&
      segments[1] === "chats" &&
      (segments.at(-1)?.endsWith(".json") === true || segments.at(-1)?.endsWith(".jsonl") === true),
    parseGemini,
  );

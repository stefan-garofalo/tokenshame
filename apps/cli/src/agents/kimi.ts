import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFolders } from "./folders";
import { NullableCount, NullableText, countOf, timeOf } from "./json-tools";
import { decodeLines, readFiles, toCount, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader, UsageRecord } from "./types";

/** Kimi CLI wire logs name no model; every Kimi CLI session runs Kimi's coding model. */
const kimiModel = "kimi-for-coding";

const Count = Schema.optionalKey(Schema.Finite);

const WireLine = Schema.Struct({
  message: Schema.optionalKey(
    Schema.Struct({
      payload: Schema.optionalKey(
        Schema.Struct({
          message_id: Schema.optionalKey(Schema.String),
          token_usage: Schema.optionalKey(
            Schema.Struct({
              input_cache_creation: Count,
              input_cache_read: Count,
              input_other: Count,
              output: Count,
            }),
          ),
        }),
      ),
      type: Schema.optionalKey(Schema.String),
    }),
  ),
  timestamp: Count,
});

const decodeWireLine = Schema.decodeUnknownOption(Schema.fromJsonString(WireLine));

const parseKimi: ParseFile = (file) => {
  const session = `kimi:${file.segments.at(-2) ?? ""}`;
  return Option.map(decodeLines(file.text, decodeWireLine), (lines) => {
    // Kimi repeats a StatusUpdate under the same message id as it streams: the last copy wins.
    const byMessage = new Map<string, UsageRecord>();
    for (const [index, line] of lines.entries()) {
      const { payload, type } = line.message ?? {};
      const usage = payload?.token_usage;
      if (type === "StatusUpdate" && usage !== undefined) {
        const seconds = toCount(line.timestamp);
        byMessage.set(payload?.message_id ?? `#${index}`, {
          at: seconds > 0 ? Math.round(seconds * 1000) : file.mtimeMs,
          cacheRead: toCount(usage.input_cache_read),
          cacheWrite: toCount(usage.input_cache_creation),
          input: toCount(usage.input_other),
          model: kimiModel,
          output: toCount(usage.output),
          session,
        });
      }
    }
    return [...byMessage.values()];
  });
};

/**
 * Kimi CLI. Reads `~/.kimi/sessions/<group>/<session>/wire.jsonl`, one session per folder.
 * Each `StatusUpdate` message carries `payload.token_usage`: `input_other`, `output`,
 * `input_cache_read`, `input_cache_creation` map to `input`, `output`, `cacheRead`,
 * `cacheWrite` (Kimi keeps cache out of `input_other`). `at` is the line `timestamp`
 * (epoch seconds). The log names no model, so every record uses `kimi-for-coding`.
 * Kimi Code (`~/.kimi-code`) uses another layout: `readKimiCode` reads it.
 */
export const readKimi: Reader = (home) =>
  readFiles(
    "Kimi",
    home,
    [".kimi", "sessions"],
    (segments) => segments.length === 3 && segments[2] === "wire.jsonl",
    parseKimi,
  );

const KimiCodeLine = Schema.Struct({
  agentId: NullableText,
  model: NullableText,
  time: NullableCount,
  type: Schema.String,
  usage: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        inputCacheCreation: NullableCount,
        inputCacheRead: NullableCount,
        inputOther: NullableCount,
        output: NullableCount,
      }),
    ),
  ),
  usageScope: NullableText,
});

const decodeKimiCodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(KimiCodeLine));

/** A model id, unless it is empty or a config placeholder such as `__kimi_env_model__`. */
const concreteModel = (model: string | null | undefined): string | undefined => {
  const trimmed = model?.trim() ?? "";
  const placeholder = trimmed.length >= 4 && trimmed.startsWith("__") && trimmed.endsWith("__");
  return trimmed === "" || placeholder ? undefined : trimmed;
};

// Segments below `sessions`: `<workspace>/<session>/agents/<agent>/wire.jsonl`.
const parseKimiCode: ParseFile = (file) => {
  const [, sessionDir = "", , agent] = file.segments;
  const session = `kimi-code:${sessionDir}`;
  return Option.map(decodeLines(file.text, decodeKimiCodeLine), (lines) => {
    // `usage.record` may name only the configured alias; the `llm.request` before it names
    // the model the provider served.
    let requestModel: string | undefined;
    return lines.flatMap((line) => {
      if (line.type === "llm.request") {
        requestModel = concreteModel(line.model) ?? requestModel;
        return [];
      }
      const { usage } = line;
      const ownAgent =
        line.agentId === null || line.agentId === undefined || line.agentId === agent;
      if (
        line.type !== "usage.record" ||
        line.usageScope !== "turn" ||
        !ownAgent ||
        usage === null ||
        usage === undefined
      ) {
        return [];
      }
      return [
        {
          at: timeOf(line.time, file.mtimeMs),
          cacheRead: countOf(usage.inputCacheRead),
          cacheWrite: countOf(usage.inputCacheCreation),
          input: countOf(usage.inputOther),
          model: requestModel ?? concreteModel(line.model) ?? unknownModel,
          output: countOf(usage.output),
          session,
        },
      ];
    });
  });
};

const kimiDesktopHome = [
  "kimi-desktop",
  "daimon-share",
  "daimon",
  "runtime",
  "kimi-code",
  "home",
  "sessions",
];

/**
 * Kimi Code (MoonshotAI's successor to Kimi CLI) and the Kimi desktop app, which runs the same
 * agent. Reads `<home>/sessions/<workspace>/<session>/agents/<agent>/wire.jsonl`, one session
 * per session folder (main agent and sub-agents together; each agent's usage is only in its
 * own wire). The homes, all read:
 * - `KIMI_CODE_HOME` when set, else `~/.kimi-code` (the same on every platform);
 * - the desktop runtime `kimi-desktop/daimon-share/daimon/runtime/kimi-code/home` below
 *   `~/Library/Application Support` (macOS) and `~/AppData/Roaming` (Windows); there is no
 *   Linux build. A `shareDir` moved in `daimon-storage.json` is not followed.
 *
 * Mapping, from `usage.record` lines with `usageScope: "turn"` only (`session`-scoped records
 * are bookkeeping such as compaction and may repeat turn usage): `usage.inputOther`, `output`,
 * `inputCacheRead`, `inputCacheCreation` map to `input`, `output`, `cacheRead`, `cacheWrite`
 * (cache is kept out of `inputOther`). `model` = the model of the latest `llm.request`, else
 * the record's own `model` (an alias), else unknown. `at` = `time` (epoch ms), else the file
 * time. A record whose `agentId` names another agent is skipped.
 */
export const readKimiCode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const codeHome = yield* environmentFolder("KIMI_CODE_HOME");
    return yield* readFolders(
      "Kimi Code",
      [
        path.join(
          Option.getOrElse(codeHome, () => path.join(home, ".kimi-code")),
          "sessions",
        ),
        path.join(home, "Library", "Application Support", ...kimiDesktopHome),
        path.join(home, "AppData", "Roaming", ...kimiDesktopHome),
      ],
      (segments) =>
        segments.length === 5 && segments[2] === "agents" && segments[4] === "wire.jsonl",
      parseKimiCode,
    );
  });

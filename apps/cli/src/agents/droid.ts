import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readFiles, stemOf, toCount, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const DroidSettings = Schema.Struct({
  effectiveFactoryRouterModel: Schema.optionalKey(Schema.Struct({ modelId: Text })),
  model: Text,
  tokenUsage: Schema.optionalKey(
    Schema.Struct({
      cacheCreationTokens: Count,
      cacheReadTokens: Count,
      inputTokens: Count,
      outputTokens: Count,
      thinkingTokens: Count,
    }),
  ),
});

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(DroidSettings));

const parseDroid: ParseFile = (file) =>
  Option.map(decodeSettings(file.text), (settings) => {
    const usage = settings.tokenUsage;
    if (usage === undefined) {
      return [];
    }
    // With the router model `auto`, the model Factory Router last served is the real one.
    const routed = settings.effectiveFactoryRouterModel?.modelId;
    const model = settings.model === "auto" && routed !== undefined ? routed : settings.model;
    return [
      {
        at: file.mtimeMs,
        cacheRead: toCount(usage.cacheReadTokens),
        cacheWrite: toCount(usage.cacheCreationTokens),
        input: toCount(usage.inputTokens),
        model: model ?? unknownModel,
        output: toCount(usage.outputTokens) + toCount(usage.thinkingTokens),
        session: `droid:${stemOf(file.segments, ".settings.json")}`,
      },
    ];
  });

/**
 * Droid (Factory). Reads `~/.factory/sessions/<project>/<id>.settings.json`, one session per
 * file. `tokenUsage` holds the session's running totals, so each file gives one record:
 * `inputTokens`, `cacheReadTokens`, `cacheCreationTokens` map to `input`, `cacheRead`,
 * `cacheWrite`; `output` = `outputTokens` + `thinkingTokens`. `model` is the settings `model`.
 * The transcript `<id>.jsonl` holds no token counts and is not read. Totals carry no
 * per-message time, so `at` is the settings file's last change.
 */
export const readDroid: Reader = (home) =>
  readFiles(
    "Droid",
    home,
    [".factory", "sessions"],
    (segments) => segments.length >= 2 && segments.at(-1)?.endsWith(".settings.json") === true,
    parseDroid,
  );

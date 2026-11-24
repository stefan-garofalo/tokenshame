import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFiles, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const SessionFile = Schema.Struct({
  session_id: Text,
  session_state: Schema.optionalKey(
    Schema.Struct({
      conversation_metadata: Schema.optionalKey(
        Schema.Struct({
          user_turn_metadatas: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                cache_read_input_token_count: Count,
                cache_write_input_token_count: Count,
                end_timestamp: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
                input_token_count: Count,
                output_token_count: Count,
              }),
            ),
          ),
        }),
      ),
      rts_model_state: Schema.optionalKey(
        Schema.Struct({
          model_info: Schema.optionalKey(Schema.Struct({ model_id: Text })),
        }),
      ),
    }),
  ),
});

const decodeSessionFile = Schema.decodeUnknownOption(Schema.fromJsonString(SessionFile));

/** Epoch ms below this are taken as seconds. */
const millisecondsFrom = 1_000_000_000_000;

const parseKiro: ParseFile = (file) =>
  Option.map(decodeSessionFile(file.text), (data) => {
    const state = data.session_state;
    const modelId = state?.rts_model_state?.model_info?.model_id?.trim() ?? "";
    const model = modelId === "" ? unknownModel : modelId;
    const session = `kiro:${data.session_id ?? stemOf(file.segments, ".json")}`;
    return (state?.conversation_metadata?.user_turn_metadatas ?? []).map((turn) => {
      const end = turn.end_timestamp;
      return {
        at: Predicate.isNumber(end)
          ? Math.trunc(end < millisecondsFrom ? end * 1000 : end)
          : toEpochMs(end, file.mtimeMs),
        cacheRead: toCount(turn.cache_read_input_token_count),
        cacheWrite: toCount(turn.cache_write_input_token_count),
        input: toCount(turn.input_token_count),
        model,
        output: toCount(turn.output_token_count),
        session,
      };
    });
  });

/**
 * Kiro CLI keeps one summary per session, `<kiro home>/sessions/cli/<id>.json`, where the
 * Kiro home is `KIRO_HOME`, else `~/.kiro`. Each `session_state.conversation_metadata.
 * user_turn_metadatas` entry is one user turn with its real counts: `input_token_count`,
 * `output_token_count`, `cache_read_input_token_count`, `cache_write_input_token_count`
 * (kept as separate counts, as tokscale reads them). The Auto agent writes zeros there; such
 * turns hold no usage and are dropped, never estimated.
 * `session` = `kiro:` + `session_id` (else the file name), `model` =
 * `session_state.rts_model_state.model_info.model_id` (else unknown), `at` = `end_timestamp`
 * (epoch seconds), else file time.
 *
 * Not read, because they hold no real token counts: the Kiro IDE's globalStorage
 * (`kiro.kiroagent`) and `~/.kiro/sessions/<workspace>/sess_*` logs, and kiro-cli's
 * `data.sqlite3` (its `request_metadata` has context percentage and response size only).
 */
export const readKiro: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const kiroHome = yield* environmentFolder("KIRO_HOME");
    return yield* readFiles(
      "Kiro",
      Option.getOrElse(kiroHome, () => path.join(home, ".kiro")),
      ["sessions", "cli"],
      (segments) => segments.length === 1 && segments[0]?.endsWith(".json") === true,
      parseKiro,
    );
  });

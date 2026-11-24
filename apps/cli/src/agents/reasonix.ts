import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFolders } from "./folders";
import { decodeLines, exclusive, stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);

/** One line of a Reasonix stats file: the usage of one provider request. */
const Stat = Schema.Struct({
  cache_hit: Count,
  cache_miss: Count,
  completion: Count,
  model: Schema.optionalKey(Schema.String),
  prompt: Count,
  ts: Schema.Union([Schema.String, Schema.Finite]),
  turn: Schema.optionalKey(Schema.Boolean),
});

const decodeStat = Schema.decodeUnknownOption(Schema.fromJsonString(Stat));

/** Times below this are epoch seconds, not milliseconds. */
const millisecondsFrom = 1e12;

const parseStats: ParseFile = (file) => {
  const session = `reasonix:${stemOf(file.segments, ".jsonl")}`;
  return Option.map(decodeLines(file.text, decodeStat), (stats) =>
    stats.flatMap((stat) => {
      if (stat.turn === true) {
        return [];
      }
      const cacheRead = toCount(stat.cache_hit);
      const cacheMiss = toCount(stat.cache_miss);
      return [
        {
          at: Predicate.isNumber(stat.ts)
            ? Math.trunc(stat.ts < millisecondsFrom ? stat.ts * 1000 : stat.ts)
            : toEpochMs(stat.ts, file.mtimeMs),
          cacheRead,
          cacheWrite: 0,
          input: cacheMiss > 0 ? cacheMiss : exclusive(toCount(stat.prompt), cacheRead),
          model: stat.model === undefined || stat.model.trim() === "" ? unknownModel : stat.model,
          output: toCount(stat.completion),
          session,
        },
      ];
    }),
  );
};

/**
 * Reasonix writes one line per provider request to `<state folder>/stats/YYYY-MM-DD.jsonl`.
 * The state folder is `REASONIX_STATE_HOME`, else `REASONIX_HOME`, else `~/.reasonix`
 * (macOS, Linux) and `~/AppData/Roaming/reasonix` (Windows); both defaults are read.
 * Session transcripts are not read: they hold no token counts.
 *
 * Mapping: `model` = `model` as logged (`provider/model`), `at` = `ts` (ISO text, or epoch
 * seconds or milliseconds). `cacheRead` = `cache_hit`. `prompt` counts cache inside it, so
 * `input` = `cache_miss` when it is above zero, else `prompt` - `cache_hit`. `output` =
 * `completion` (`reasoning` is part of it). Lines with `turn: true` sum a turn's requests and
 * are skipped. Requests carry no session id, so each day's file is one session.
 */
export const readReasonix: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const stateHome = yield* environmentFolder("REASONIX_STATE_HOME");
    const reasonixHome = yield* environmentFolder("REASONIX_HOME");
    const override = Option.orElse(stateHome, () => reasonixHome);
    const folders: readonly [string, ...string[]] = Option.isSome(override)
      ? [path.join(override.value, "stats")]
      : [
          path.join(home, ".reasonix", "stats"),
          path.join(home, "AppData", "Roaming", "reasonix", "stats"),
        ];
    return yield* readFolders(
      "Reasonix",
      folders,
      (segments) => segments.length === 1 && segments[0]?.endsWith(".jsonl") === true,
      parseStats,
    );
  });

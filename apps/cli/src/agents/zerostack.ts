import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFolders } from "./folders";
import { stemOf, toCount, toEpochMs, unknownModel } from "./pi";
import type { ParseFile } from "./pi";
import type { Reader } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

/** The part of a zerostack session file that holds its usage totals. */
const Session = Schema.Struct({
  created_at: Text,
  id: Text,
  model: Text,
  total_input_tokens: Count,
  total_output_tokens: Count,
  updated_at: Text,
});

const decodeSession = Schema.decodeUnknownOption(Schema.fromJsonString(Session));

const parseSession: ParseFile = (file) =>
  Option.map(decodeSession(file.text), (session) => [
    {
      at: toEpochMs(session.updated_at ?? session.created_at, file.mtimeMs),
      cacheRead: 0,
      cacheWrite: 0,
      input: toCount(session.total_input_tokens),
      model: session.model ?? unknownModel,
      output: toCount(session.total_output_tokens),
      session: `zerostack:${session.id ?? stemOf(file.segments, ".json")}`,
    },
  ]);

/**
 * zerostack (gi-dellav/zerostack) keeps one JSON file per session in `<data folder>/sessions/`.
 * The data folder is `ZS_DATA_DIR`, when set; else the platform data folder plus `zerostack`:
 * `~/Library/Application Support/zerostack` (macOS), `$XDG_DATA_HOME/zerostack` or
 * `~/.local/share/zerostack` (Linux), `~/AppData/Roaming/zerostack` (Windows). Every default
 * that exists is read.
 *
 * zerostack stores only running session totals, so each file is one record: `input` =
 * `total_input_tokens`, `output` = `total_output_tokens`, no cache counts, `model` = `model`,
 * `at` = `updated_at`, else `created_at`, `session` = `zerostack:` + `id`.
 */
export const readZerostack: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const override = yield* environmentFolder("ZS_DATA_DIR");
    const dataHome = Option.getOrElse(yield* environmentFolder("XDG_DATA_HOME"), () =>
      path.join(home, ".local", "share"),
    );
    const folders: readonly [string, ...string[]] = Option.isSome(override)
      ? [path.join(override.value, "sessions")]
      : [
          path.join(home, "Library", "Application Support", "zerostack", "sessions"),
          path.join(dataHome, "zerostack", "sessions"),
          path.join(home, "AppData", "Roaming", "zerostack", "sessions"),
        ];
    return yield* readFolders(
      "zerostack",
      folders,
      (segments) => segments.length === 1 && segments[0]?.endsWith(".json") === true,
      parseSession,
    );
  });

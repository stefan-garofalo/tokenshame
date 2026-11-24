import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { environmentFolder } from "./env";
import { jsonlFiles, readFolders } from "./folders";
import { piSessionParser } from "./pi";
import type { Reader } from "./types";

/**
 * gajae-code (`gjc`), a fork of Pi with Pi's session format. Reads every `*.jsonl` below each
 * of these folders: `<slug>/<session>.jsonl`, and the sub-agent passes `<slug>/<session>/N-*.jsonl`.
 * - the default `~/.gjc/agent/sessions`;
 * - `GJC_CODING_AGENT_DIR/sessions`, when set;
 * - `GJC_CONFIG_DIR/agent/sessions`, when set;
 * - `$XDG_DATA_HOME/gjc/sessions`, when set (gjc drops the `agent` folder there).
 * `PI_CONFIG_DIR`, which gjc also honours, is not read: it names Pi's own folder.
 * Mapping as for Pi (see `pi.ts`). A sub-agent pass repeats the calls of its session, and a
 * fork copies them; each call is counted once, across all folders.
 */
export const readGjc: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const below = (variable: string, ...parts: readonly string[]) =>
      Effect.map(environmentFolder(variable), (folder) =>
        Option.toArray(folder).map((found) => path.join(found, ...parts)),
      );
    return yield* readFolders(
      "gajae-code",
      [
        path.join(home, ".gjc", "agent", "sessions"),
        ...(yield* below("GJC_CODING_AGENT_DIR", "sessions")),
        ...(yield* below("GJC_CONFIG_DIR", "agent", "sessions")),
        ...(yield* below("XDG_DATA_HOME", "gjc", "sessions")),
      ],
      jsonlFiles,
      piSessionParser("gjc"),
    );
  });

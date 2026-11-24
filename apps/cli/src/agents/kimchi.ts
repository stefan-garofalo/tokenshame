import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { environmentFolder } from "./env";
import { jsonlFiles } from "./folders";
import { piSessionParser, readFiles } from "./pi";
import type { Reader } from "./types";

/**
 * Kimchi Coding, a fork of Pi with Pi's session format. Reads every `*.jsonl` below
 * `<agent folder>/sessions`, one session per file. The agent folder is
 * `KIMCHI_CODING_AGENT_DIR`, else `~/.config/kimchi/harness` (the same on every platform).
 * Mapping as for Pi (see `pi.ts`). A call a fork copied is counted once.
 */
export const readKimchi: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const agentFolder = Option.getOrElse(yield* environmentFolder("KIMCHI_CODING_AGENT_DIR"), () =>
      path.join(home, ".config", "kimchi", "harness"),
    );
    return yield* readFiles(
      "Kimchi",
      agentFolder,
      ["sessions"],
      jsonlFiles,
      piSessionParser("kimchi"),
    );
  });

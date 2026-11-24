import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { environmentFolder } from "./env";
import { jsonlFiles, readFolders } from "./folders";
import { piSessionParser } from "./pi";
import type { Reader } from "./types";

/**
 * Senpi, and OmO Native (`omo-ai` 5.1.0 and later), forks of Pi with Pi's session format.
 * Reads every `*.jsonl` below each of these folders, one session per file:
 * - `<agent folder>/sessions`, where the agent folder is `SENPI_CODING_AGENT_DIR`, else
 *   `~/.senpi/agent`;
 * - `~/.omo/agent/sessions` (OmO Native);
 * - `SENPI_CODING_AGENT_SESSION_DIR`, when set.
 * OmO task children kept inside each project (`<project>/.omo/senpi-task/children`) are not
 * read: only the home folder is known. Mapping as for Pi (see `pi.ts`); `usage.reasoning` is
 * part of `output` and is not added. A call a fork copied is counted once, across all folders.
 */
export const readSenpi: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const sessionFolder = yield* environmentFolder("SENPI_CODING_AGENT_SESSION_DIR");
    const agentFolder = Option.getOrElse(yield* environmentFolder("SENPI_CODING_AGENT_DIR"), () =>
      path.join(home, ".senpi", "agent"),
    );
    return yield* readFolders(
      "Senpi",
      [
        path.join(agentFolder, "sessions"),
        path.join(home, ".omo", "agent", "sessions"),
        ...Option.toArray(sessionFolder),
      ],
      jsonlFiles,
      piSessionParser("senpi"),
    );
  });

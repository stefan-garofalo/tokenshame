import { piSessionParser, readFiles } from "./pi";
import { jsonlFiles } from "./folders";
import type { Reader } from "./types";

/**
 * Oh My Pi (`omp`), a fork of Pi with Pi's session format. Reads
 * `~/.omp/agent/sessions/<project>/<time>_<id>.jsonl`, and the files of its sub-agents in
 * `<time>_<id>/<agent>.jsonl` beside it; each file is one session. Mapping as for Pi:
 * `message.model`, `message.usage` `input`, `output`, `cacheRead`, `cacheWrite`, the line's
 * `timestamp`; the session is the `session` header line's `id`. A call a fork copied is
 * counted once. `PI_CODING_AGENT_DIR` is not read: omp shares it with Pi, so honouring it
 * would read Pi's sessions as omp's.
 */
export const readOmp: Reader = (home) =>
  readFiles("Oh My Pi", home, [".omp", "agent", "sessions"], jsonlFiles, piSessionParser("omp"));

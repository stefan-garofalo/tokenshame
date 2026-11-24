import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readTranscripts } from "./claude";
import type { Reader } from "./types";

/**
 * OpenClaude (npm `@gitlawb/openclaude`), a Claude Code fork for any LLM, writes Claude Code
 * transcripts to `~/.openclaude/projects/<project>/<session>.jsonl` (format from codeburn's
 * `openclaude.ts`). The sibling `<session>.replay.json` files hold no usage and are not read.
 * Sub-agent lines (`isSidechain`) are real calls and count. Mapping and de-duplication as in
 * `readTranscripts`, with `session` = `openclaude:` + `sessionId`.
 */
export const readOpenClaude: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = path.join(home, ".openclaude");
    return yield* readTranscripts({
      agent: "OpenClaude",
      path: folder,
      roots: [path.join(folder, "projects")],
      sessionPrefix: "openclaude",
    });
  });

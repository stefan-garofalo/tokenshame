import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readBuddyLogs } from "./codebuddy";
import type { Reader } from "./types";

/**
 * WorkBuddy (Tencent) writes the CodeBuddy transcript format to
 * `~/.workbuddy-ai/projects/<project>/*.jsonl` (WorkBuddy 5.5 and later) and
 * `~/.workbuddy/projects/<project>/*.jsonl` (older installs; both are read). Mapping and
 * de-duplication as in `readBuddyLogs`, with `session` = `workbuddy:` + `sessionId`.
 * `workbuddy.db` is not read: its `session_usage.used` is one total per session with no
 * input, output or cache split.
 */
export const readWorkBuddy: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const folder = path.join(home, ".workbuddy-ai");
    return yield* readBuddyLogs(
      "WorkBuddy",
      "workbuddy",
      [path.join(folder, "projects"), path.join(home, ".workbuddy", "projects")],
      folder,
    );
  });

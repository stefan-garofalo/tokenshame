import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { readTranscripts } from "./claude";
import { environmentFolder } from "./env";
import type { Reader } from "./types";

/**
 * Qoder and Qoder CN (Alibaba) write Claude Code style transcripts:
 * - `$QODER_CONFIG_DIR/projects`, else `~/.qoder/projects`;
 * - `$QODERCN_CONFIG_DIR/projects`, else `~/.qoder-cn/projects`;
 * one `<session>.jsonl` per session, sub-agents in `<session>/subagents/`.
 * `*.checkpoints.jsonl` snapshots are not read. Format from tokscale's `qoder.rs`.
 *
 * Qoder keeps real counts in `message.usage` only with a custom (BYOK) model or with
 * `QODER_EXPOSE_TOKEN_USAGE=1`; otherwise it drops `usage` or writes zeros, and those lines
 * count nothing (tokscale estimates them from text; this reader does not). Assistant lines
 * of Qoder 1.1.82 and later name the model `auto`; the model is then the last
 * `businessModelKey` (or `runtime-config` model) before the line. Mapping and de-duplication
 * as in `readTranscripts`, with `session` = `qoder:` + `sessionId`.
 */
export const readQoder: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const qoder = Option.getOrElse(yield* environmentFolder("QODER_CONFIG_DIR"), () =>
      path.join(home, ".qoder"),
    );
    const qoderCn = Option.getOrElse(yield* environmentFolder("QODERCN_CONFIG_DIR"), () =>
      path.join(home, ".qoder-cn"),
    );
    return yield* readTranscripts({
      agent: "Qoder",
      path: qoder,
      roots: [path.join(qoder, "projects"), path.join(qoderCn, "projects")],
      sessionPrefix: "qoder",
    });
  });

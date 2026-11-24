import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { readClineTasks } from "./cline-tasks";
import { environmentFolder } from "./env";
import type { Reader } from "./types";
import { editorUserFolders } from "./vscode";

/**
 * Cline's own data folder, as the Cline CLI and JetBrains plugin resolve it:
 * `CLINE_DATA_DIR`, else `CLINE_DIR/data`, else `~/.cline/data`.
 */
export const clineDataFolder = (home: string): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* dataFolder() {
    const path = yield* Path.Path;
    const dataDir = yield* environmentFolder("CLINE_DATA_DIR");
    const clineDir = yield* environmentFolder("CLINE_DIR");
    return Option.getOrElse(dataDir, () =>
      path.join(
        Option.getOrElse(clineDir, () => path.join(home, ".cline")),
        "data",
      ),
    );
  });

/**
 * Cline (VS Code extension `saoudrizwan.claude-dev`, and its standalone data folder). Reads
 * `tasks/<task id>/ui_messages.json` below the extension's globalStorage in Code,
 * Code - Insiders and VSCodium (macOS, Linux and Windows app data folders, and
 * `~/.vscode-server/data`), and below Cline's data folder (`CLINE_DATA_DIR`, else
 * `CLINE_DIR/data`, else `~/.cline/data`). Format and mapping: `readClineTasks`.
 * Cline keeps `tokensIn`, `cacheReads` and `cacheWrites` as separate counts on purpose
 * ("disjoint buckets" in Cline's `message-translator.ts`), so `input` = `tokensIn`.
 */
export const readCline: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const users = yield* editorUserFolders(home);
    return yield* readClineTasks({ agent: "Cline", grossInput: () => false, slug: "cline" }, [
      ...users.map((user) => path.join(user, "globalStorage", "saoudrizwan.claude-dev")),
      yield* clineDataFolder(home),
    ]);
  });

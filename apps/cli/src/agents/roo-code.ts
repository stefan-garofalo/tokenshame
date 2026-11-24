import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readClineTasks, rooGrossInput } from "./cline-tasks";
import type { Reader } from "./types";
import { editorUserFolders } from "./vscode";

/**
 * Roo Code (VS Code extension `rooveterinaryinc.roo-cline`). Reads
 * `tasks/<task id>/ui_messages.json` below the extension's globalStorage in Code,
 * Code - Insiders and VSCodium (macOS, Linux and Windows app data folders, and
 * `~/.vscode-server/data`). Format and mapping: `readClineTasks`.
 * Since v3.29.5 (2025-11) Roo logs `tokensIn` with cache reads and writes inside, and before
 * that only on the OpenAI protocol; those rows get `input` = `tokensIn` - cache reads - cache
 * writes (`rooGrossInput`).
 */
export const readRooCode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const users = yield* editorUserFolders(home);
    return yield* readClineTasks(
      { agent: "Roo Code", grossInput: rooGrossInput, slug: "roo" },
      users.map((user) => path.join(user, "globalStorage", "rooveterinaryinc.roo-cline")),
    );
  });

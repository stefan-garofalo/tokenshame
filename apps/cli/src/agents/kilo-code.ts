import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readClineTasks, rooGrossInput } from "./cline-tasks";
import type { Reader } from "./types";
import { editorUserFolders } from "./vscode";

/**
 * Kilo Code (VS Code extension `kilocode.kilo-code`, a Roo Code fork). Reads
 * `tasks/<task id>/ui_messages.json` below the extension's globalStorage in Code,
 * Code - Insiders and VSCodium (macOS, Linux and Windows app data folders, and
 * `~/.vscode-server/data`). Format and mapping: `readClineTasks`; cache comes out of
 * `tokensIn` by the Roo Code rule (`rooGrossInput`).
 * The Kilo CLI's SQLite store (`~/.local/share/kilo/kilo.db`) is a different source and is
 * not read here.
 */
export const readKiloCode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const users = yield* editorUserFolders(home);
    return yield* readClineTasks(
      { agent: "Kilo Code", grossInput: rooGrossInput, slug: "kilo" },
      users.map((user) => path.join(user, "globalStorage", "kilocode.kilo-code")),
    );
  });

import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readClineTasks, rooGrossInput } from "./cline-tasks";
import type { Reader } from "./types";
import { appDataFolders } from "./vscode";

/**
 * IBM Bob (an IDE whose agent, `ibm.bob-code`, logs Roo-style task folders). Reads
 * `<app data>/IBM Bob/User/globalStorage/ibm.bob-code/tasks/<task id>/ui_messages.json`,
 * and the same below `Bob-IDE` (the preview-era app name), in the macOS, Linux and Windows
 * app data folders. Format and mapping: `readClineTasks`. Bob writes the Roo-style
 * `<model>` tag, so cache comes out of `tokensIn` by the Roo Code rule (`rooGrossInput`).
 */
export const readIbmBob: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const bases = yield* appDataFolders(home);
    return yield* readClineTasks(
      { agent: "IBM Bob", grossInput: rooGrossInput, slug: "bob" },
      bases.flatMap((base) =>
        ["IBM Bob", "Bob-IDE"].map((app) =>
          path.join(base, app, "User", "globalStorage", "ibm.bob-code"),
        ),
      ),
    );
  });

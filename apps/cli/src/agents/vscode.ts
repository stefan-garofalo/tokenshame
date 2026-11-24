import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { environmentFolder } from "./env";

// Shared by the readers of VS Code-family editors and their extensions (Cline, Roo Code,
// Kilo Code, IBM Bob, Copilot (VS Code), Cursor).

/**
 * The per-user app data folders where Electron apps keep their `User` folder, built from
 * `home`: macOS `Library/Application Support`, Linux `.config`, Windows `AppData/Roaming`.
 * Every one is checked, so the reader needs no OS switch. On Linux the editors honour
 * `XDG_CONFIG_HOME`, so that folder is added when it is set.
 */
export const appDataFolders = (home: string): Effect.Effect<readonly string[], never, Path.Path> =>
  Effect.gen(function* appData() {
    const path = yield* Path.Path;
    const configHome = yield* environmentFolder("XDG_CONFIG_HOME");
    return [
      ...new Set([
        path.join(home, "Library", "Application Support"),
        path.join(home, ".config"),
        path.join(home, "AppData", "Roaming"),
        ...Option.toArray(configHome),
      ]),
    ];
  });

/** The VS Code builds the reference readers check for extension data. */
const editors = ["Code", "Code - Insiders", "VSCodium"];

/** Each editor's `User` folder, plus the one VS Code Remote keeps on a server. */
export const editorUserFolders = (
  home: string,
): Effect.Effect<readonly string[], never, Path.Path> =>
  Effect.gen(function* userFolders() {
    const path = yield* Path.Path;
    const bases = yield* appDataFolders(home);
    return [
      ...bases.flatMap((base) => editors.map((editor) => path.join(base, editor, "User"))),
      path.join(home, ".vscode-server", "data", "User"),
    ];
  });

/** A file's text and last change. */
export interface TextFile {
  readonly path: string;
  readonly text: string;
  readonly mtimeMs: number;
}

/** Reads one file, or none when it is missing or cannot be read. */
export const readTextFile = (
  file: string,
): Effect.Effect<Option.Option<TextFile>, never, FileSystem.FileSystem> =>
  Effect.gen(function* readText() {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file);
    const info = yield* fs.stat(file);
    const mtime = Option.getOrElse(info.mtime, () => new Date());
    return Option.some({ mtimeMs: mtime.getTime(), path: file, text });
  }).pipe(Effect.orElseSucceed(() => Option.none<TextFile>()));

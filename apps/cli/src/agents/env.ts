import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

/**
 * A folder an agent lets the user move with an environment variable, such as `CODEX_HOME`.
 * An unset or empty variable is none, so the reader falls back to its default folder.
 */
export const environmentFolder = (name: string): Effect.Effect<Option.Option<string>> =>
  Config.option(Config.NonEmptyString(name)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );

/** The data folder of an XDG tool: `$XDG_DATA_HOME/<name>`, else `~/.local/share/<name>`. */
export const xdgDataFolder = (home: string, name: string) =>
  Effect.gen(function* resolveFolder() {
    const path = yield* Path.Path;
    const dataHome = yield* environmentFolder("XDG_DATA_HOME");
    return Option.match(dataHome, {
      onNone: () => path.join(home, ".local", "share", name),
      onSome: (data) => path.join(data, name),
    });
  });

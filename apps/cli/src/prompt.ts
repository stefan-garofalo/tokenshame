import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Terminal from "effect/Terminal";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

/** The system opener could not open the link. `reason` is a short human cause. */
export class OpenError extends Data.TaggedError("OpenError")<{ readonly reason: string }> {}

/** Opens a URL in the user's browser. Tests pass a stub: this is the only seam that starts a process. */
export type Open = (
  url: string,
) => Effect.Effect<void, OpenError, ChildProcessSpawner.ChildProcessSpawner>;

// The URL holds only base64url and fixed path characters, so no shell quoting is needed.
const openerCommand = (platform: NodeJS.Platform, url: string): ChildProcess.StandardCommand => {
  const quiet = { stderr: "ignore", stdin: "ignore", stdout: "ignore" } as const;
  if (platform === "darwin") {
    return ChildProcess.make("open", [url], quiet);
  }
  if (platform === "win32") {
    // `start` is a cmd builtin; the empty string is its window title argument.
    return ChildProcess.make("cmd", ["/c", "start", "", url], quiet);
  }
  return ChildProcess.make("xdg-open", [url], quiet);
};

/** Starts `open`, `xdg-open`, or `start` for the URL, and waits for it to hand the URL over. */
export const openInBrowser: Open = (url) =>
  Effect.gen(function* launch() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exit = yield* spawner
      .exitCode(openerCommand(process.platform, url))
      .pipe(Effect.mapError((error) => new OpenError({ reason: error.message })));
    return yield* exit === 0
      ? Effect.void
      : Effect.fail(new OpenError({ reason: `the system opener exited with code ${exit}` }));
  });

const isEnter = ({ key }: Terminal.UserInput): boolean =>
  key.name === "return" || key.name === "enter";

/**
 * Waits for one keypress. Only Enter says yes; Ctrl-C, Esc, any other key, and closed
 * input (no terminal, CI) say no, so nothing opens by accident.
 */
const consent: Effect.Effect<boolean, never, Terminal.Terminal> = Effect.scoped(
  Effect.gen(function* confirm() {
    const terminal = yield* Terminal.Terminal;
    const keys = yield* terminal.readInput;
    return yield* Queue.take(keys).pipe(
      Effect.map(isEnter),
      Effect.orElseSucceed(() => false),
    );
  }),
);

/** The consent step: asks, and opens the Share Link only after Enter. */
export const shareLink = (
  url: string,
  open: Open,
): Effect.Effect<void, never, Terminal.Terminal | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* share() {
    yield* Console.log("Press Enter to open the Share Link in your browser, or Ctrl-C to cancel.");
    if (yield* consent) {
      yield* open(url).pipe(
        Effect.catchTag("OpenError", ({ reason }) =>
          Console.error(`Could not open a browser (${reason}). Copy the Share Link above instead.`),
        ),
      );
    }
  });

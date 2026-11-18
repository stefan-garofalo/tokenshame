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

/**
 * The system opener for a platform: program and arguments, the URL always one argument.
 * Windows runs `rundll32 url.dll,FileProtocolHandler` and not `cmd /c start`: `start` goes
 * through the cmd parser, where `&`, `^`, or `|` in a URL would run as commands. `rundll32`
 * starts no shell, so the URL reaches the default browser unchanged.
 */
export const openerFor = (
  platform: NodeJS.Platform,
  url: string,
): readonly [program: string, args: readonly string[]] => {
  if (platform === "darwin") {
    return ["open", [url]];
  }
  if (platform === "win32") {
    return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  }
  return ["xdg-open", [url]];
};

const openerCommand = (platform: NodeJS.Platform, url: string): ChildProcess.StandardCommand => {
  const [program, args] = openerFor(platform, url);
  return ChildProcess.make(program, [...args], {
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  });
};

/** Starts `open`, `xdg-open`, or `rundll32` for the URL, and waits for it to hand the URL over. */
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

import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

/**
 * Raw usage of one model, as one Usage Source logged it. Counts are non-negative
 * safe integers and never include prompt text, project names, or paths.
 *
 * A reader emits one record per usage event or per aggregate, whichever its
 * source stores. The summary builder sums the counts per `model`, counts the
 * distinct `session` keys, takes the first day from the earliest `at`, and the
 * busiest hour from `at`.
 */
export interface UsageRecord {
  /** The raw model id exactly as the agent logs it. The server maps ids to names. */
  readonly model: string;
  /**
   * Session key. Records with the same key are one session. It must be unique
   * across agents, so start it with the agent name. A source that only stores
   * totals uses one stable key per aggregate.
   */
  readonly session: string;
  /** When the usage happened, in epoch milliseconds. */
  readonly at: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** A source with usage: the records of one agent. Readers return at least one record here. */
export interface ReadUsage {
  readonly _tag: "Read";
  readonly records: readonly UsageRecord[];
}

/**
 * A source that gave no usage, so the CLI counts every other source and says why.
 *
 * - `no-data`: the folder or file is missing, or holds no usage. Normal for an
 *   agent the user does not run; the CLI lists `path` only when no source has data.
 * - `unreadable`: the source exists but could not be opened or parsed. The CLI
 *   prints a message naming `agent`, with `detail` as the cause.
 */
export interface SkippedSource {
  readonly _tag: "Skipped";
  /** Display name of the agent, for example "Claude Code". */
  readonly agent: string;
  /** The folder or file the reader checked. */
  readonly path: string;
  readonly reason: "no-data" | "unreadable";
  /** Short human cause for `unreadable`; empty for `no-data`. */
  readonly detail: string;
}

export type ReadResult = ReadUsage | SkippedSource;

/**
 * The one contract every agent reader implements: a plain function from the
 * user's home folder to what its Usage Source holds.
 *
 * - Build every path from `home` with `Path`, never by string concatenation.
 * - Never fail: catch each `FileSystem` and parse error and return `Skipped`.
 * - Read only; never write, spawn, or touch the network.
 * - Never import the summary builder, the web app, or `@tokenshame/share-link`.
 */
export type Reader = (
  home: string,
) => Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path>;

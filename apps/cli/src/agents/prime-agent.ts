import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { environmentFolder } from "./env";
import { readFolders } from "./folders";
import { countOnce, exclusive, piCalls, toCount } from "./pi";
import type { ParseFile, PiCall } from "./pi";
import type { Reader, UsageRecord } from "./types";

const Count = Schema.optionalKey(Schema.Finite);
const Usage = Schema.Struct({ cacheRead: Count, cacheWrite: Count, input: Count, output: Count });

/** A parent's note that a child session's usage is part of the usage of the parent's call `targetId`. */
const Attribution = Schema.Struct({
  aggregateUsage: Usage,
  childUsage: Usage,
  targetId: Schema.String,
  type: Schema.Literal("child_usage_attributed"),
});

const decodeAttribution = Schema.decodeUnknownOption(Schema.fromJsonString(Attribution));

type Counts = Pick<UsageRecord, "cacheRead" | "cacheWrite" | "input" | "output">;

const countsOf = (usage: typeof Usage.Type): Counts => ({
  cacheRead: toCount(usage.cacheRead),
  cacheWrite: toCount(usage.cacheWrite),
  input: toCount(usage.input),
  output: toCount(usage.output),
});

const sameCounts = (a: Counts, b: Counts): boolean =>
  a.input === b.input &&
  a.output === b.output &&
  a.cacheRead === b.cacheRead &&
  a.cacheWrite === b.cacheWrite;

/**
 * Prime can write a parent call's usage as the aggregate of the call and the child sessions
 * it spawned. Its attribution lines then name an `aggregateUsage` equal to that usage; the
 * children of that attribution and the ones before it are taken out of the parent call,
 * because the children's own files are read too.
 */
const withoutChildren = (text: string, calls: readonly PiCall[]): readonly PiCall[] => {
  const byTarget = new Map<string, (typeof Attribution.Type)[]>();
  for (const line of text.split("\n")) {
    for (const attribution of Option.toArray(decodeAttribution(line))) {
      byTarget.set(attribution.targetId, [
        ...(byTarget.get(attribution.targetId) ?? []),
        attribution,
      ]);
    }
  }
  return calls.map((call) => {
    const attributions = (call.id === undefined ? undefined : byTarget.get(call.id)) ?? [];
    let last = -1;
    for (const [index, attribution] of attributions.entries()) {
      if (sameCounts(countsOf(attribution.aggregateUsage), call.record)) {
        last = index;
      }
    }
    if (last < 0) {
      return call;
    }
    const children = attributions.slice(0, last + 1).map(({ childUsage }) => countsOf(childUsage));
    const sum = (field: keyof Counts) => children.reduce((total, child) => total + child[field], 0);
    return {
      ...call,
      record: {
        ...call.record,
        cacheRead: exclusive(call.record.cacheRead, sum("cacheRead")),
        cacheWrite: exclusive(call.record.cacheWrite, sum("cacheWrite")),
        input: exclusive(call.record.input, sum("input")),
        output: exclusive(call.record.output, sum("output")),
      },
    };
  });
};

/** A parser for one read: a fork copies its parent's lines, so each call is counted once. */
const makeParse = (): ParseFile => {
  const seen = new Set<string>();
  return (file) =>
    Option.map(piCalls("prime", file), (calls) =>
      countOnce(seen, withoutChildren(file.text, calls)),
    );
};

/**
 * Prime Agent (PrimeIntellect), a fork of Pi with Pi's session format. Reads root sessions,
 * `<sessions>/*.jsonl`, and the RLM child sessions in the sibling folder,
 * `session-artifacts/<root>/<child>/*.jsonl` (not the `rlm-subagents.jsonl` index):
 * - `<sessions>` is `PRIME_AGENT_SESSION_DIR` or `PRIME_AGENT_CODING_AGENT_SESSION_DIR`, when
 *   set; else `<agent folder>/sessions`, where the agent folder is
 *   `PRIME_AGENT_CODING_AGENT_DIR`, else `~/.prime/agent`.
 * A `sessionDir` set in Prime's `settings.json` is not read.
 *
 * Mapping as for Pi (see `pi.ts`); each file is one session. A call a fork copied is counted
 * once. `child_usage_attributed` lines are not usage: when one shows that a parent call's
 * usage includes its children, their usage is taken out of the parent call (see
 * `withoutChildren`). If a child's file is gone, its usage is then missing from the total.
 */
export const readPrimeAgent: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const path = yield* Path.Path;
    const sessionFolder = yield* environmentFolder("PRIME_AGENT_SESSION_DIR");
    const legacySessionFolder = yield* environmentFolder("PRIME_AGENT_CODING_AGENT_SESSION_DIR");
    const agentFolder = Option.getOrElse(
      yield* environmentFolder("PRIME_AGENT_CODING_AGENT_DIR"),
      () => path.join(home, ".prime", "agent"),
    );
    const sessions = Option.getOrElse(
      Option.orElse(sessionFolder, () => legacySessionFolder),
      () => path.join(agentFolder, "sessions"),
    );
    return yield* readFolders(
      "Prime Agent",
      [sessions, path.join(path.dirname(sessions), "session-artifacts")],
      (segments) => {
        const name = segments.at(-1) ?? "";
        return name.endsWith(".jsonl") && name !== "rlm-subagents.jsonl";
      },
      makeParse(),
    );
  });

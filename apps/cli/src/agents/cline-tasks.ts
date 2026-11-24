import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { exclusive, toCount, toEpochMs, unknownModel } from "./pi";
import type { ReadResult, UsageRecord } from "./types";
import { readTextFile } from "./vscode";
import type { TextFile } from "./vscode";
import { listFolder, usageResult } from "./folders";

// Shared by the readers of the Cline task-folder format: Cline, Roo Code, Kilo Code, IBM Bob.

/** How one product of the Cline family logs its task folders. */
export interface TaskFormat {
  /** Display name, for example "Roo Code". */
  readonly agent: string;
  /** Session key prefix, for example `roo`. */
  readonly slug: string;
  /** True when a row's `tokensIn` already includes its `cacheReads` and `cacheWrites`. */
  readonly grossInput: (at: number, apiProtocol: string | undefined) => boolean;
}

/** First millisecond (2025-11-02 UTC) after Roo Code v3.29.5 began to log `tokensIn` with cache inside. */
const rooGrossFromMs = 1_762_041_600_000;

/**
 * The Roo Code rule, as tokscale documents it from Roo's own source (`416fa5727e`, v3.29.5):
 * rows from v3.29.5 on log `tokensIn` with cache inside for every protocol; older rows did so
 * only for the OpenAI protocol (`apiProtocol` `openai`, also as the last part of `a/openai`).
 */
export const rooGrossInput: TaskFormat["grossInput"] = (at, apiProtocol) =>
  at >= rooGrossFromMs || apiProtocol?.trim().split("/").at(-1)?.toLowerCase() === "openai";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const UiMessage = Schema.Struct({
  modelInfo: Schema.optionalKey(Schema.Struct({ modelId: Text })),
  say: Text,
  text: Text,
  ts: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
  type: Text,
});

const ApiRequest = Schema.Struct({
  apiProtocol: Text,
  cacheReads: Count,
  cacheWrites: Count,
  tokensIn: Count,
  tokensOut: Count,
});

const decodeUiMessages = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.Unknown)),
);
const decodeUiMessage = Schema.decodeUnknownOption(UiMessage);
const decodeApiRequest = Schema.decodeUnknownOption(Schema.fromJsonString(ApiRequest));

interface Request {
  readonly at: number;
  readonly model: Option.Option<string>;
  readonly usage: typeof ApiRequest.Type;
}

/** The `api_req_started` rows of one `ui_messages.json`, or none when the file is corrupt. */
const requestsOf = (file: TextFile): Option.Option<readonly Request[]> =>
  Option.map(decodeUiMessages(file.text), (entries) =>
    entries.flatMap((entry) =>
      Option.toArray(
        decodeUiMessage(entry).pipe(
          Option.filter((message) => message.type === "say" && message.say === "api_req_started"),
          Option.flatMap((message) =>
            Option.map(decodeApiRequest(message.text ?? ""), (usage) => ({
              at: Predicate.isNumber(message.ts)
                ? Math.trunc(message.ts)
                : toEpochMs(message.ts, file.mtimeMs),
              model: Option.fromNullishOr(message.modelInfo?.modelId?.trim()).pipe(
                Option.filter((model) => model !== ""),
              ),
              usage,
            })),
          ),
        ),
      ),
    ),
  );

const environmentDetails = /<environment_details>(?<block>[\s\S]*?)<\/environment_details>/gu;
const modelTag = /<model>(?<model>[^<]*)<\/model>/u;

/**
 * The model named in the last `<environment_details>` block of the task's
 * `api_conversation_history.json`, as Roo-style extensions write it. Read as text, not parsed.
 */
const historyModel = (text: string): Option.Option<string> =>
  Option.fromNullishOr(
    [...text.matchAll(environmentDetails)]
      .map((match) => modelTag.exec(match.groups?.block ?? "")?.groups?.model?.trim() ?? "")
      .findLast((model) => model !== ""),
  );

const toRecord = (format: TaskFormat, session: string, model: string, request: Request) => {
  const { usage } = request;
  const tokensIn = toCount(usage.tokensIn);
  const cacheRead = toCount(usage.cacheReads);
  const cacheWrite = toCount(usage.cacheWrites);
  return {
    at: request.at,
    cacheRead,
    cacheWrite,
    input: format.grossInput(request.at, usage.apiProtocol)
      ? exclusive(tokensIn, cacheRead + cacheWrite)
      : tokensIn,
    model: Option.getOrElse(request.model, () => model),
    output: toCount(usage.tokensOut),
    session,
  } satisfies UsageRecord;
};

interface Task {
  readonly id: string;
  readonly folder: string;
  readonly file: TextFile;
}

/** The records of one task, or none when its `ui_messages.json` is corrupt. */
const readTask = (format: TaskFormat, task: Task) =>
  Effect.gen(function* taskRecords() {
    const path = yield* Path.Path;
    const requests = requestsOf(task.file);
    if (Option.isNone(requests)) {
      return Option.none<readonly UsageRecord[]>();
    }
    // The history file can be large; it is only read when a row names no model itself.
    const needsModel = requests.value.some((request) => Option.isNone(request.model));
    const history = needsModel
      ? yield* readTextFile(path.join(task.folder, "api_conversation_history.json"))
      : Option.none<TextFile>();
    const model = history.pipe(
      Option.flatMap((file) => historyModel(file.text)),
      Option.getOrElse(() => unknownModel),
    );
    const session = `${format.slug}:${task.id}`;
    return Option.some(requests.value.map((request) => toRecord(format, session, model, request)));
  });

/**
 * Reads `<root>/tasks/<task id>/ui_messages.json` below each of `roots`. A task id found
 * below several roots (the same task copied between editors) is read once, from its newest
 * copy. Each `say: "api_req_started"` row is one model call; its `text` is a JSON object
 * with `tokensIn`, `tokensOut`, `cacheReads`, `cacheWrites`, `apiProtocol`.
 * - `session` = slug + `:` + task id; `at` = the row's `ts` (epoch ms), else file time.
 * - `model` = the row's `modelInfo.modelId`, else the last `<model>` tag of the task's
 *   `api_conversation_history.json`, else unknown.
 * - `input` = `tokensIn`, minus cache when `format.grossInput` says the row counts it inside.
 */
export const readClineTasks = (
  format: TaskFormat,
  roots: readonly string[],
): Effect.Effect<ReadResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* readTasks() {
    const path = yield* Path.Path;
    const unique = [...new Set(roots)];
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const candidates = (yield* Effect.forEach(unique, (root) =>
      Effect.map(listFolder(path.join(root, "tasks")), (ids) =>
        ids.map((id) => ({ folder: path.join(root, "tasks", id), id })),
      ),
    )).flat();
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const found = yield* Effect.forEach(
      candidates,
      (candidate) =>
        Effect.map(
          readTextFile(path.join(candidate.folder, "ui_messages.json")),
          Option.map((file): Task => ({ ...candidate, file })),
        ),
      { concurrency: 8 },
    );
    const newest = new Map<string, Task>();
    for (const task of found.flatMap(Option.toArray)) {
      const seen = newest.get(task.id);
      if (seen === undefined || task.file.mtimeMs > seen.file.mtimeMs) {
        newest.set(task.id, task);
      }
    }
    const tasks = [...newest.values()];
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const parsed = yield* Effect.forEach(tasks, (task) => readTask(format, task), {
      concurrency: 8,
    });
    const corrupt = parsed.filter(Option.isNone).length;
    return usageResult(
      format.agent,
      unique[0] ?? "",
      parsed.flatMap((records) => Option.getOrElse(records, () => [])),
      corrupt > 0 ? [`${corrupt} of ${parsed.length} files could not be parsed`] : [],
    );
  });

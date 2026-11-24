import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { exclusive, toCount, unknownModel } from "./pi";
import type { Reader, UsageRecord } from "./types";
import { editorUserFolders, readTextFile } from "./vscode";
import type { TextFile } from "./vscode";
import { listFolder, usageResult } from "./folders";

const agent = "Copilot (VS Code)";

const Count = Schema.optionalKey(Schema.Finite);
const Text = Schema.optionalKey(Schema.String);

const Session = Schema.Struct({
  creationDate: Count,
  requests: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  sessionId: Text,
});

const Request = Schema.Struct({
  completionTokens: Count,
  modelId: Text,
  modelTotals: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  promptTokens: Count,
  requestId: Text,
  result: Schema.optionalKey(
    Schema.Struct({
      metadata: Schema.optionalKey(
        Schema.Struct({ outputTokens: Count, promptTokens: Count, resolvedModel: Text }),
      ),
    }),
  ),
  timestamp: Count,
});

const ModelTotal = Schema.Struct({ cachedTokens: Count, inputTokens: Count, outputTokens: Count });

const JournalLine = Schema.Struct({
  k: Schema.optionalKey(Schema.Array(Schema.Union([Schema.String, Schema.Finite]))),
  kind: Schema.Finite,
  v: Schema.optionalKey(Schema.MutableJson),
});

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.MutableJson));
const decodeJournalLine = Schema.decodeUnknownOption(Schema.fromJsonString(JournalLine));
const decodeSession = Schema.decodeUnknownOption(Session);
const decodeRequest = Schema.decodeUnknownOption(Request);
const decodeModelTotal = Schema.decodeUnknownOption(ModelTotal);

type Json = Schema.MutableJson;
type Key = string | number;

const isJsonObject = (value: Json | undefined): value is Schema.MutableJsonObject =>
  Predicate.isObject(value) && !Array.isArray(value);

const childOf = (target: Json | undefined, key: Key): Json | undefined => {
  if (Predicate.isNumber(key)) {
    return Array.isArray(target) ? target[key] : undefined;
  }
  return isJsonObject(target) ? target[key] : undefined;
};

/** `target` with `value` put at `path`, making the objects and arrays on the way. */
const setAt = (target: Json | undefined, path: readonly Key[], value: Json): Json => {
  const [key, ...rest] = path;
  if (key === undefined) {
    return value;
  }
  if (Predicate.isNumber(key)) {
    const array = Array.isArray(target) ? target : [];
    array[key] = setAt(array[key], rest, value);
    return array;
  }
  const object = isJsonObject(target) ? target : {};
  // A key that would replace the prototype is not a value of the log.
  if (key !== "__proto__") {
    object[key] = setAt(object[key], rest, value);
  }
  return object;
};

/**
 * Replays a VS Code chat session journal: `kind` 0 is the whole session, 1 sets the value
 * at path `k`, 2 appends the items of `v` to the array at `k` (default `requests`).
 * None when no line decodes: the file is corrupt.
 */
const replayJournal = (text: string): Option.Option<Json> => {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let session: Json = {};
  let decoded = 0;
  for (const line of lines) {
    const entry = decodeJournalLine(line);
    if (Option.isNone(entry)) {
      continue;
    }
    decoded += 1;
    const { k, kind, v = null } = entry.value;
    if (kind === 0) {
      session = v;
    } else if (kind === 1 && k !== undefined) {
      session = setAt(session, k, v);
    } else if (kind === 2) {
      const at = k ?? ["requests"];
      let existing: Json | undefined = session;
      for (const key of at) {
        existing = childOf(existing, key);
      }
      session = setAt(session, at, [
        ...(Array.isArray(existing) ? existing : []),
        ...(Array.isArray(v) ? v : []),
      ]);
    }
  }
  return lines.length > 0 && decoded === 0 ? Option.none() : Option.some(session);
};

interface Usage {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

/**
 * `modelTotals` sums every model call of a request (an agent request makes one per tool
 * round). Its `inputTokens` includes `cachedTokens`, except from the Claude SDK, which
 * counts them apart: an input below its cached part can only be that.
 */
const totalsOf = (entries: readonly unknown[]): Option.Option<Usage> => {
  const totals = entries.flatMap((entry) => Option.toArray(decodeModelTotal(entry)));
  if (totals.length === 0) {
    return Option.none();
  }
  const sum = (pick: (total: typeof ModelTotal.Type) => number | undefined) =>
    totals.reduce((acc, total) => acc + toCount(pick(total)), 0);
  const cached = sum((total) => total.cachedTokens);
  return Option.some({
    cacheRead: cached,
    input: exclusive(
      sum((total) => total.inputTokens),
      cached,
    ),
    output: sum((total) => total.outputTokens),
  });
};

const usageOf = (request: typeof Request.Type): Usage => {
  const metadata = request.result?.metadata;
  return Option.getOrElse(totalsOf(request.modelTotals ?? []), () => ({
    cacheRead: 0,
    // The request's own counts sum every round; `result.metadata` has the last round only.
    input: toCount(request.promptTokens ?? metadata?.promptTokens),
    output: toCount(request.completionTokens ?? metadata?.outputTokens),
  }));
};

const modelOf = (request: typeof Request.Type): string => {
  const resolved = request.result?.metadata?.resolvedModel?.trim() ?? "";
  const picked = resolved === "" ? (request.modelId?.trim() ?? "") : resolved;
  const model = picked.startsWith("copilot/") ? picked.slice("copilot/".length) : picked;
  return model === "" ? unknownModel : model;
};

interface ChatFile {
  readonly file: TextFile;
  readonly stem: string;
  readonly emptyWindow: boolean;
}

/** The session a chat file holds, or none when the file is corrupt. */
const sessionOf = (chat: ChatFile): Option.Option<typeof Session.Type> =>
  (chat.file.path.endsWith(".jsonl")
    ? replayJournal(chat.file.text)
    : decodeJson(chat.file.text)
  ).pipe(Option.map((value) => Option.getOrElse(decodeSession(value), () => ({}))));

/**
 * The records of every chat file, or none for a corrupt one. VS Code copies a chat into
 * workspace storage when an empty window opens a folder, and keeps the original; later
 * writes go to the copy. So copies come first, newest first, and each request (session id
 * and request id) is counted once.
 */
const recordsOf = (chats: readonly ChatFile[]): Option.Option<UsageRecord[]>[] => {
  const seen = new Set<string>();
  const ordered = chats.toSorted(
    (a, b) => Number(a.emptyWindow) - Number(b.emptyWindow) || b.file.mtimeMs - a.file.mtimeMs,
  );
  return ordered.map((chat) =>
    Option.map(sessionOf(chat), (session) => {
      const sessionId = session.sessionId ?? chat.stem;
      return (session.requests ?? []).flatMap((raw, index) =>
        Option.toArray(decodeRequest(raw)).flatMap((request) => {
          const key = `${sessionId}:${request.requestId ?? request.timestamp ?? index}`;
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
          return [
            {
              ...usageOf(request),
              at: Math.trunc(request.timestamp ?? session.creationDate ?? chat.file.mtimeMs),
              cacheWrite: 0,
              model: modelOf(request),
              session: `copilot-vscode:${sessionId}`,
            },
          ];
        }),
      );
    }),
  );
};

const chatNames = (names: readonly string[]): readonly string[] =>
  names.filter((name) => name.endsWith(".jsonl") || name.endsWith(".json"));

/** Every chat file below one editor `User` folder, as paths with their empty-window flag. */
const chatPaths = (user: string) =>
  Effect.gen(function* listChats() {
    const path = yield* Path.Path;
    const workspaces = path.join(user, "workspaceStorage");
    const hashes = yield* listFolder(workspaces);
    // The unicorn rules mistake `Effect.forEach` for `Array#forEach`.
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const inWorkspaces = yield* Effect.forEach(hashes, (hash) => {
      const folder = path.join(workspaces, hash, "chatSessions");
      return Effect.map(listFolder(folder), (names) =>
        chatNames(names).map((name) => ({ emptyWindow: false, file: path.join(folder, name) })),
      );
    });
    const empty = path.join(user, "globalStorage", "emptyWindowChatSessions");
    const inEmptyWindows = chatNames(yield* listFolder(empty)).map((name) => ({
      emptyWindow: true,
      file: path.join(empty, name),
    }));
    return [...inWorkspaces.flat(), ...inEmptyWindows];
  });

const readChat = (found: { readonly emptyWindow: boolean; readonly file: string }) =>
  Effect.gen(function* readOne() {
    const path = yield* Path.Path;
    const file = yield* readTextFile(found.file);
    const name = path.basename(found.file);
    return file.pipe(
      Option.map((text): ChatFile => ({
        emptyWindow: found.emptyWindow,
        file: text,
        stem: name.slice(0, name.lastIndexOf(".")),
      })),
    );
  });

/**
 * GitHub Copilot Chat in VS Code. VS Code keeps each chat session as
 * `<User>/workspaceStorage/<hash>/chatSessions/<session id>.jsonl` (a journal; older builds
 * wrote one `.json` snapshot), and chats of windows with no folder open below
 * `<User>/globalStorage/emptyWindowChatSessions/`. `<User>` is the `User` folder of Code,
 * Code - Insiders and VSCodium (macOS, Linux and Windows app data folders) and of
 * `~/.vscode-server/data`.
 *
 * Mapping, per entry of `requests` (one chat request, which may make several model calls):
 * - `modelTotals` when present: `input` = sum of `inputTokens` - sum of `cachedTokens`,
 *   `cacheRead` = sum of `cachedTokens`, `output` = sum of `outputTokens` (see `totalsOf`);
 * - else `input` = `promptTokens` (else `result.metadata.promptTokens`), `output` =
 *   `completionTokens` (else `result.metadata.outputTokens`), no cache split. `output` already
 *   holds thinking; `toolCallRounds[].thinking.tokens` is not added.
 * - `session` = `copilot-vscode:` + `sessionId` (else the file name); `model` =
 *   `result.metadata.resolvedModel`, else `modelId`, without its `copilot/` prefix;
 *   `at` = the request's `timestamp` (epoch ms), else the session's `creationDate`, else
 *   file time.
 * The Copilot CLI (`~/.copilot`) is a separate source with its own reader.
 */
export const readCopilotVscode: Reader = (home) =>
  Effect.gen(function* readFromHome() {
    const users = yield* editorUserFolders(home);
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const found = (yield* Effect.forEach(users, chatPaths)).flat();
    // oxlint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-method-this-argument
    const chats = yield* Effect.forEach(found, readChat, { concurrency: 8 });
    const parsed = recordsOf(chats.flatMap(Option.toArray));
    const corrupt = parsed.filter(Option.isNone).length;
    return usageResult(
      agent,
      users[0] ?? "",
      parsed.flatMap((records) => Option.getOrElse(records, () => [])),
      corrupt > 0 ? [`${corrupt} of ${parsed.length} files could not be parsed`] : [],
    );
  });

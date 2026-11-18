import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { isString } from "effect/Predicate";
import * as Schema from "effect/Schema";

import v1 from "./fixtures/v1.json";
import { BrokenLink, decode, encode, shareUrl } from "./link";
import { Summary, tokensProcessed } from "./summary";

const origin = "https://tokenshame.vercel.app";

// The v1 wire format written out by hand, independent of the implementation.
const wireV1 = {
  v: 1,
  m: [{ n: "gpt-5", i: 1, o: 2, r: 3, w: 4 }],
  x: { i: 5, o: 6, r: 7, w: 8 },
  s: 9,
  h: 10,
  d: "2025-01-31",
};

const toLink = (wire: unknown): string => Buffer.from(JSON.stringify(wire)).toString("base64url");

const assertBroken = (link: string) =>
  Effect.gen(function* () {
    assert.instanceOf(yield* Effect.flip(decode(link)), BrokenLink);
  });

const stringLeaves = (json: string): string[] => {
  const found: string[] = [];
  JSON.parse(json, (_key, value) => {
    if (isString(value)) {
      found.push(value);
    }
    return value;
  });
  return found;
};

describe("share link round trip", () => {
  it.effect.prop(
    "decode(encode(summary)) returns the same summary",
    { summary: Summary },
    ({ summary }) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(yield* decode(encode(summary)), summary);
      }),
  );

  it.effect.prop(
    "a decoded link encodes back to the same link, so one link means one summary",
    { summary: Summary },
    ({ summary }) =>
      Effect.gen(function* () {
        const link = encode(summary);
        assert.strictEqual(encode(yield* decode(link)), link);
      }),
  );

  it.effect("decodes the hand-written v1 wire format", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decode(toLink(wireV1)), {
        version: 1,
        models: [{ model: "gpt-5", input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }],
        other: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8 },
        sessions: 9,
        busiestHour: 10,
        firstDay: "2025-01-31",
      });
    }),
  );
});

// One entry per link version ever shipped: add a fixture, never edit or remove one.
const shipped = [{ version: 1, fixture: v1 }];

describe("old share links keep working", () => {
  for (const { version, fixture } of shipped) {
    it.effect(`decodes the committed v${version} link to its summary`, () =>
      Effect.gen(function* () {
        const expected = yield* Schema.decodeUnknownEffect(Summary)(fixture.summary);
        assert.deepStrictEqual(yield* decode(fixture.link), expected);
      }),
    );
  }

  it.effect("the headline of the v1 fixture is the raw total of every count in it", () =>
    Effect.gen(function* () {
      // opus 915.5M + codex 120.79M + sonnet 55.3M + other 3.07M
      assert.strictEqual(tokensProcessed(yield* decode(v1.link)), 1_094_660_000);
    }),
  );
});

describe("share url", () => {
  it("puts the link under /r/ on the site origin", () => {
    assert.strictEqual(shareUrl(origin, "abc"), "https://tokenshame.vercel.app/r/abc");
    assert.strictEqual(shareUrl("http://localhost:3001/", "abc"), "http://localhost:3001/r/abc");
  });
});

describe("share link length", () => {
  it.effect.prop(
    "any summary gives a Share URL of at most 2,000 characters",
    { summary: Summary },
    ({ summary }) =>
      Effect.sync(() => {
        assert.isAtMost(shareUrl(origin, encode(summary)).length, 2000);
      }),
  );

  it.effect("the worst-case summary gives a Share URL of at most 2,000 characters", () =>
    Effect.gen(function* () {
      const full = {
        input: Number.MAX_SAFE_INTEGER,
        output: Number.MAX_SAFE_INTEGER,
        cacheRead: Number.MAX_SAFE_INTEGER,
        cacheWrite: Number.MAX_SAFE_INTEGER,
      };
      const worst: Summary = {
        version: 1,
        models: Array.from({ length: 8 }, (_, index) => ({
          model: `${"m".repeat(63)}${index}`,
          ...full,
        })),
        other: full,
        sessions: Number.MAX_SAFE_INTEGER,
        busiestHour: 23,
        firstDay: "9999-12-31",
      };
      const link = encode(worst);
      assert.isAtMost(shareUrl(origin, link).length, 2000);
      assert.deepStrictEqual(yield* decode(link), worst);
    }),
  );
});

describe("share link carries only numbers", () => {
  it.effect.prop(
    "the only text in a link is its model ids and its first day",
    { summary: Summary },
    ({ summary }) =>
      Effect.sync(() => {
        const json = Buffer.from(encode(summary), "base64url").toString();
        assert.sameMembers(stringLeaves(json), [
          ...summary.models.map(({ model }) => model),
          summary.firstDay,
        ]);
      }),
  );

  it.effect.prop("a link is URL-safe", { summary: Summary }, ({ summary }) =>
    Effect.sync(() => {
      assert.match(encode(summary), /^[A-Za-z0-9_-]+$/);
    }),
  );

  const smuggled = {
    "a key for prompt text": { ...wireV1, prompt: "write me a poem about my secret project" },
    "a key for prompt text inside a model": {
      ...wireV1,
      m: [{ ...wireV1.m[0], text: "write me a poem" }],
    },
    "a model id that is a sentence": { ...wireV1, m: [{ ...wireV1.m[0], n: "write me a poem" }] },
    "a model id that is a Windows path": {
      ...wireV1,
      m: [{ ...wireV1.m[0], n: String.raw`C:\Users\me\secret-project` }],
    },
    "a model id longer than 64 characters": {
      ...wireV1,
      m: [{ ...wireV1.m[0], n: "m".repeat(65) }],
    },
    "an empty model id": { ...wireV1, m: [{ ...wireV1.m[0], n: "" }] },
    "nine models": { ...wireV1, m: Array.from({ length: 9 }, () => wireV1.m[0]) },
  };
  for (const [name, wire] of Object.entries(smuggled)) {
    it.effect(`rejects ${name}`, () => assertBroken(toLink(wire)));
  }
});

describe("share link rejects broken input", () => {
  const link = toLink(wireV1);

  it.effect("accepts the valid v1 link used as the base of these cases", () =>
    Effect.asVoid(decode(link)),
  );

  const unusable = {
    "an empty link": "",
    "text that is not base64url": "not a link!",
    "base64url of text that is not JSON": Buffer.from("hello").toString("base64url"),
    "base64url of a JSON array": toLink([]),
    "base64url of JSON null": toLink(null),
    "base64url of a JSON number": toLink(42),
    "a version that was never shipped": toLink({ ...wireV1, v: 2 }),
    "version 0": toLink({ ...wireV1, v: 0 }),
    "a missing version": toLink({ ...wireV1, v: undefined }),
    "a version written as text": toLink({ ...wireV1, v: "1" }),
    "a negative model count": toLink({ ...wireV1, m: [{ ...wireV1.m[0], i: -1 }] }),
    "a negative other count": toLink({ ...wireV1, x: { ...wireV1.x, o: -5 } }),
    "a negative session count": toLink({ ...wireV1, s: -1 }),
    "a fractional model count": toLink({ ...wireV1, m: [{ ...wireV1.m[0], r: 1.5 }] }),
    "a fractional session count": toLink({ ...wireV1, s: 2.5 }),
    "a count above the safe integer range": toLink({ ...wireV1, s: 2 ** 53 }),
    "a count written as text": toLink({ ...wireV1, s: "3" }),
    "a missing count": toLink({ ...wireV1, x: { i: 1, o: 2, r: 3 } }),
    "an hour above 23": toLink({ ...wireV1, h: 24 }),
    "a negative hour": toLink({ ...wireV1, h: -1 }),
    "a fractional hour": toLink({ ...wireV1, h: 3.5 }),
    "a first day that is not a date": toLink({ ...wireV1, d: "yesterday" }),
    "a first day that does not exist": toLink({ ...wireV1, d: "2025-02-31" }),
  };
  for (const [name, input] of Object.entries(unusable)) {
    it.effect(`rejects ${name}`, () => assertBroken(input));
  }

  it.effect("rejects every truncation of a valid link", () =>
    Effect.forEach(
      Array.from({ length: link.length }, (_, length) => link.slice(0, length)),
      assertBroken,
    ),
  );
});

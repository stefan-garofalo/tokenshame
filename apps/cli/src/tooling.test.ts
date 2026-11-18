import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

describe("test tooling", () => {
  it.effect("runs an Effect inside a colocated test", () =>
    Effect.map(Effect.succeed(1234), (tokens) => {
      assert.strictEqual(tokens, 1234);
    }),
  );
});

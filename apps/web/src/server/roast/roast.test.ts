import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import v1 from "@tokenshame/share-link/fixtures/v1.json";
import { Summary, tokensProcessed } from "@tokenshame/share-link/summary";

import { factors, prices, roast } from "./index";

const decode = Schema.decodeUnknownSync(Summary);

const zeros = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const summaryOf = (models: Summary["models"], other = zeros): Summary =>
  decode({ version: 1, models, other, sessions: 10, busiestHour: 3, firstDay: "2025-01-01" });

const fixture = decode(v1.summary);

/** Runs a property over summaries drawn from the real Summary schema. `undefined` means it held. */
const failureOf = async (property: (summary: Summary) => boolean): Promise<string | undefined> =>
  Arbitrary.formatCheckFailure(
    await Effect.runPromise(Arbitrary.checkEffect(Arbitrary.schema(Summary), property)),
  );

const withModel = (usage: Partial<typeof zeros>) =>
  roast(summaryOf([{ model: "claude-opus-4-5", ...zeros, ...usage }]));

/** Every Roast Line of a result: the KPIs, then the rest. */
const linesOf = ({ kpis, rest }: ReturnType<typeof roast>) => [...kpis, ...rest];

const publicStrings = (summary: Summary): string[] => {
  const result = roast(summary);
  return [
    result.headline.label,
    result.headline.figure,
    result.cost.figure,
    ...result.models.map(({ name }) => name),
    ...linesOf(result).flatMap(({ text, figure, unit }) => [text, figure, unit]),
    ...result.kpis.flatMap(({ tile }) => [tile.label, tile.quip]),
  ];
};

describe("headline (AC-032)", () => {
  it("is the raw total of every count, labelled tokens processed", () => {
    const result = roast(fixture);
    expect(result.headline.tokens).toBe(1_094_660_000);
    expect(result.headline.figure).toBe("1,094,660,000");
    expect(result.headline.label).toBe("tokens processed");
  });

  it("equals tokensProcessed for every summary", async () => {
    await expect(
      failureOf((summary) => roast(summary).headline.tokens === tokensProcessed(summary)),
    ).resolves.toBeUndefined();
  });
});

describe("same link, same lines (AC-037, INV-003)", () => {
  it("gives identical output on two calls for every summary", async () => {
    await expect(
      failureOf(
        (summary) =>
          JSON.stringify(roast(summary)) === JSON.stringify(roast(structuredClone(summary))),
      ),
    ).resolves.toBeUndefined();
  });

  it("ranks the rest by dread, highest first, for every summary", async () => {
    await expect(
      failureOf((summary) => {
        const { rest } = roast(summary);
        return rest.every((line, at) => at === 0 || rest[at - 1].dread >= line.dread);
      }),
    ).resolves.toBeUndefined();
  });

  it("gives the bento its KPIs in a fixed order: water, sea ice, glacier, ocean, land", () => {
    const { kpis, rest } = roast(fixture);
    expect(kpis.map(({ id }) => id)).toStrictEqual(["water", "ice", "glacier", "ocean", "land"]);
    expect(rest[0].id).toBe("meals");
  });

  it("breaks a dread tie by a hash of the summary, so tied lines swap places between summaries", () => {
    const orders = new Set<string>();
    for (let sessions = 0; sessions < 300; sessions += 1) {
      const { rest } = roast({ ...fixture, sessions });
      // In this summary the power and flights lines tie for third place.
      expect(rest[2].dread).toBe(rest[3].dread);
      orders.add(`${rest[2].id}>${rest[3].id}`);
    }
    expect(orders).toStrictEqual(new Set(["flights>power", "power>flights"]));
  });
});

describe("weighted tokens (AC-034)", () => {
  it("counts a cache read at the single weight from factors", () => {
    const cacheOnly = withModel({ cacheRead: 10_000_000_000 });
    const inputOnly = withModel({ input: 1_000_000_000 });
    expect(factors.cacheReadWeight.value).toBeCloseTo(0.1);
    expect(cacheOnly.weightedTokens).toBeCloseTo(10_000_000_000 * factors.cacheReadWeight.value);
    // Same weighted tokens, so every line computed from energy is the same.
    const energy = (result: typeof cacheOnly) => linesOf(result).filter(({ id }) => id !== "meals");
    expect(energy(cacheOnly)).toStrictEqual(energy(inputOnly));
  });

  it("counts input, output and cache writes at full weight", () => {
    expect(withModel({ input: 1000, output: 2000, cacheWrite: 4000 }).weightedTokens).toBe(7000);
  });

  it("prices cache reads and cache writes at their own per-model price", () => {
    const result = roast(
      summaryOf([
        {
          model: "gpt-5",
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 1_000_000,
          cacheWrite: 0,
        },
        { model: "claude-opus-4-5-20251101", ...zeros, cacheWrite: 1_000_000 },
      ]),
    );
    // gpt-5: 1.25 + 10 + 0.125. Opus 4.5 cache write: 6.25.
    expect(result.cost.usd).toBeCloseTo(17.625);
    expect(result.models.map(({ name }) => name)).toStrictEqual(["GPT-5", "Claude Opus 4.5"]);
  });
});

describe("unknown models (AC-021)", () => {
  const mystery = summaryOf([{ model: "acme-9000-turbo", ...zeros, input: 2_000_000 }]);

  it("still renders, priced at the fallback price", () => {
    const result = roast(mystery);
    expect(result.models).toStrictEqual([
      { name: expect.any(String), known: false, usd: expect.any(Number) },
    ]);
    expect(result.cost.usd).toBeGreaterThan(0);
    expect(result.kpis.length).toBeGreaterThan(0);
  });

  it("never prints the raw model id", () => {
    expect(publicStrings(mystery).join("\n")).not.toContain("acme-9000-turbo");
  });

  it("maps known raw ids to names", () => {
    const result = roast(summaryOf([{ model: "claude-sonnet-4-5-20250929", ...zeros, input: 1 }]));
    expect(result.models[0]).toMatchObject({ name: "Claude Sonnet 4.5", known: true });
  });
});

describe("empty and tiny summaries", () => {
  it("handles a summary with no tokens", () => {
    const result = roast(summaryOf([], zeros));
    expect(result.headline.tokens).toBe(0);
    expect(result.cost.usd).toBe(0);
    expect(result.weightedTokens).toBe(0);
    expect(result.kpis).toStrictEqual([]);
    expect(result.rest).toStrictEqual([]);
  });

  it("never yields NaN or Infinity, and every line shows its figure", async () => {
    await expect(
      failureOf((summary) => {
        const result = roast(summary);
        const numbers = [
          result.headline.tokens,
          result.cost.usd,
          result.weightedTokens,
          ...result.models.map(({ usd }) => usd),
          ...linesOf(result).flatMap(({ value, dread }) => [value, dread]),
        ];
        return (
          numbers.every(Number.isFinite) &&
          linesOf(result).every(
            ({ text, figure }) => text.includes(figure) && !/NaN|Infinity/u.test(text),
          )
        );
      }),
    ).resolves.toBeUndefined();
  });
});

describe("public copy (AC-033)", () => {
  it("never says cache, agent or ozone, for any summary", async () => {
    await expect(
      failureOf((summary) => !/cache|agent|ozone/iu.test(publicStrings(summary).join("\n"))),
    ).resolves.toBeUndefined();
  });

  it("never says cache even for a model id that does", () => {
    const summary = summaryOf([{ model: "cache-hog-1", ...zeros, cacheRead: 5_000_000_000 }]);
    expect(publicStrings(summary).join("\n")).not.toMatch(/cache/iu);
  });
});

describe("comparison set (AC-036)", () => {
  const byId = Object.fromEntries(linesOf(roast(fixture)).map((line) => [line.id, line]));

  it("covers water, sea ice, glacier, ocean, land, coal, meals, flights, trees, homes, CO2 and Chad", () => {
    expect(new Set(Object.keys(byId))).toStrictEqual(
      new Set([
        "coal",
        "flights",
        "glacier",
        "homes",
        "ice",
        "land",
        "meals",
        "ocean",
        "power",
        "tons",
        "trees",
        "water",
      ]),
    );
  });

  it("names the coal plant and the flight route", () => {
    expect(byId.coal.text).toContain("Vindhyachal");
    expect(byId.flights.text).toContain("New York");
  });

  it("names the drought, the Arctic, the glacier, the ocean and the data center", () => {
    expect(byId.water.text).toContain("drought zone");
    expect(byId.ice.text).toContain("Arctic sea ice");
    expect(byId.glacier.text).toContain("glacier ice");
    expect(byId.ocean.text).toContain("ocean");
    expect(byId.land.text).toContain("data center land");
  });

  it("counts melted sea ice in battery-hen cages", () => {
    const ice = roast(fixture).kpis.find(({ id }) => id === "ice");
    expect(ice?.unit).toBe("battery-hen cage");
    expect(ice?.tile.label).toBe("of Arctic sea ice");
  });

  it("prices the bill in school meals and the power in Chad", () => {
    expect(byId.meals.text).toMatch(/school meals/iu);
    expect(byId.power.text).toContain("Chad");
  });

  it("counts water in whole 500 mL bottles, a fifth of them from a drought zone", () => {
    // 1.08 litres per kWh; 0.24 mWh per token.
    const perLitre = 1 / 1.08 / 2.4e-7;
    const water = (litres: number) =>
      withModel({ input: Math.round(litres * perLitre) }).kpis.find(({ id }) => id === "water");

    expect(water(0.25)?.text).toMatch(/^You drank 250 milliliters of water\. A fifth of it/u);
    expect(water(2.1)?.text).toMatch(/^You drank 4 bottles of water\. A fifth of it/u);
    expect(water(10.1)?.text).toBe(
      "You drank 20 bottles of water. 4 came from a drought zone. Cry about it.",
    );
    expect(water(10.1)?.tile.quip).toBe("4 from a drought zone");
  });
});

describe("factors and prices carry sources (AC-035)", () => {
  const entries = [...Object.values(factors), ...prices];
  const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

  it("gives every entry a unit, a source URL and an ISO date", () => {
    for (const entry of entries) {
      expect(entry.unit).not.toBe("");
      expect(entry.source).toMatch(/^https:\/\//u);
      expect(entry.date).toMatch(isoDate);
    }
  });

  it("gives every factor a finite positive value", () => {
    for (const { value } of Object.values(factors)) {
      expect(Number.isFinite(value) && value > 0).toBeTruthy();
    }
  });

  it("lists each raw model id once", () => {
    const ids = prices.flatMap((price) => price.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pure engine (RAC-3)", () => {
  const sources = Object.entries(
    import.meta.glob("./*.ts", { query: "?raw", import: "default", eager: true }),
  )
    .filter(([path]) => !path.includes(".test."))
    .map(([path, source]) => [path, String(source)] as const);

  it("has no Node built-in, server-only import, clock, or randomness", () => {
    const forbidden = /from\s+["'](?:node:|server-only)|Math\.random|Date\.now|new Date\(/u;
    expect(sources.length).toBeGreaterThanOrEqual(6);
    expect(
      sources.filter(([, source]) => forbidden.test(source)).map(([path]) => path),
    ).toStrictEqual([]);
  });
});

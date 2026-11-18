import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { factors, prices } from "../src/server/roast/index";

const readme = readFileSync(fileURLToPath(new URL("../../../README.md", import.meta.url)), "utf-8");

const heading = "How we calculate";

// Tables show a number the way a reader writes it: grouped, never in exponent form.
const show = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 10 });

// The "How we calculate" section: from its heading to the next heading of the same level.
const section = (): string => {
  const [, rest = ""] = readme.split(new RegExp(`^## ${heading}$`, "mu"));
  return rest.split(/^## /mu)[0] ?? "";
};

// A source cell is a markdown link, `[label](url)`; the test compares its url. Other cells stay as written.
const linkTarget = (cell: string): string =>
  /^\[[^\]]+\]\((?<url>.+)\)$/u.exec(cell)?.groups?.url ?? cell;

// The cells of every table row in the section, trimmed, one array per row.
const rows = (): string[][] =>
  section()
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((cell) => cell.trim()),
    );

describe("README section: How we calculate", () => {
  it("has the heading exactly once, so the #how-we-calculate anchor works", () => {
    expect(readme.match(new RegExp(`^#{1,6} ${heading}$`, "gmu"))).toHaveLength(1);
    expect(readme).toMatch(new RegExp(`^## ${heading}$`, "mu"));
  });

  it.each(Object.entries(factors))(
    "lists factor %s with value, unit, source, date, note",
    (id, factor) => {
      const row = rows().find(([cell]) => cell === `\`${id}\``);

      expect(row?.map(linkTarget)).toStrictEqual([
        `\`${id}\``,
        show(factor.value),
        factor.unit,
        factor.source,
        factor.date,
        factor.note,
      ]);
    },
  );

  it.each(prices.map((price) => [price.name, price] as const))(
    "lists price %s with ids, four prices, source, date",
    (name, price) => {
      const row = rows().find(([cell]) => cell === name);

      expect(row?.map(linkTarget)).toStrictEqual([
        name,
        price.ids.map((id) => `\`${id}\``).join(", "),
        ...[price.input, price.output, price.cacheRead, price.cacheWrite].map(show),
        price.source,
        price.date,
      ]);
    },
  );

  it("names the price unit", () => {
    expect(new Set(prices.map(({ unit }) => unit)).size).toBe(1);
    expect(section()).toContain(prices[0]?.unit);
  });

  it("lists no price or factor the engine does not export", () => {
    const known = new Set([
      ...Object.keys(factors).map((id) => `\`${id}\``),
      ...prices.map(({ name }) => name),
    ]);
    const listed = rows()
      .map(([cell = ""]) => cell)
      .filter((cell) => cell !== "" && !/^-+$/u.test(cell));

    // Header cells are the only allowed extras: one per table.
    const unknown = listed.filter((cell) => !known.has(cell));
    expect(unknown).toStrictEqual(["Factor", "Model"]);
  });
});

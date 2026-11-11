import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { decode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { roast } from "../../../../server/roast";
import { BrokenLinkPage } from "./broken-link-page";
import { SharePage } from "./share-page";

const summary = Effect.runSync(decode(fixture.link));
const readme = "https://github.com/stefan-garofalo/tokenshame#how-we-calculate";

const render = (markup: string) => {
  const { document } = new JSDOM(`<body>${markup}</body>`).window;
  return { document, html: markup, text: document.body.textContent ?? "" };
};

describe("SharePage of the fixture link", () => {
  const page = render(renderToStaticMarkup(<SharePage roast={roast(summary)} />));
  const result = roast(summary);

  it("makes Tokens Processed the headline, as the raw total", () => {
    const heading = page.document.querySelector("h1");

    expect(heading?.textContent).toContain(result.headline.figure);
    expect(page.text).toContain("tokens processed");
  });

  it("shows every Roast Line, in engine order", () => {
    const shown = [...page.document.querySelectorAll("[data-roast-line]")].map(
      (line) => line.textContent,
    );

    expect(shown).toStrictEqual(result.lines.map(({ text }) => text));
  });

  it("shows the estimated cost", () => {
    expect(page.text).toContain(result.cost.figure);
  });

  it("links the README section from the how-we-calculated note", () => {
    const note = [...page.document.querySelectorAll("a")].find(({ textContent }) =>
      textContent?.toLowerCase().includes("how we calculated"),
    );

    expect(note?.getAttribute("href")).toBe(readme);
  });

  it("shows the npx tokenshame command in a box", () => {
    expect(page.document.querySelector("[data-command]")?.textContent).toBe("npx tokenshame");
  });

  it("leaves a named slot for each of the Post on X and Copy image buttons", () => {
    expect(page.document.querySelector('[data-slot="post-on-x"]')).not.toBeNull();
    expect(page.document.querySelector('[data-slot="copy-image"]')).not.toBeNull();
  });

  it("shows no agent list, date range, or the word cache", () => {
    const visible = `${page.html} ${page.text}`.toLowerCase();

    expect(visible).not.toContain("cache");
    expect(visible).not.toContain(summary.firstDay.slice(0, 4));
    expect(visible).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    for (const { model } of summary.models) {
      expect(visible).not.toContain(model);
    }
    for (const agent of ["claude", "codex", "opencode", "gemini", "cursor"]) {
      expect(visible).not.toContain(agent);
    }
  });
});

describe(BrokenLinkPage, () => {
  const page = render(renderToStaticMarkup(<BrokenLinkPage />));

  it("says the roast is broken and tells the visitor to run npx tokenshame", () => {
    expect(page.text).toContain("this roast is broken. Run npx tokenshame");
    expect(page.document.querySelector("[data-command]")?.textContent).toBe("npx tokenshame");
  });

  it("never says cache", () => {
    expect(`${page.html} ${page.text}`.toLowerCase()).not.toContain("cache");
  });
});

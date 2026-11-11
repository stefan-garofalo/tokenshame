import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { decode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startServer } from "../../../../../tests/http-harness";
import type { WebServer } from "../../../../../tests/http-harness";
import { roast } from "../../../../server/roast";
import { CardLayout } from "./card-layout";
import { cardContentOf } from "./card-content";
import { colors, display, tracking } from "./card-tokens";

const buildTimeoutMs = 300_000;
const firstImageBudgetMs = 1000;
const pngSignature = "89504e470d0a1a0a";
const brokenLink = "not-a-share-link";
const domain = "tokenshame.test";

const summary = Effect.runSync(decode(fixture.link));
const result = roast(summary);

// The PNG header: 8 signature bytes, then the IHDR chunk with width and height as big-endian words.
const pngSize = (bytes: Buffer) => ({
  height: bytes.readUInt32BE(20),
  signature: bytes.subarray(0, 8).toString("hex"),
  width: bytes.readUInt32BE(16),
});

const fetchCard = async (baseUrl: string, link: string) => {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/r/${link}/og.png`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, elapsedMs: performance.now() - started, response };
};

// The words the card draws, as a crawler or a screen reader would take them from the layout tree.
const textOf = async (link: string) => {
  const content = await cardContentOf(link);
  const { document } = new JSDOM(
    `<body>${renderToStaticMarkup(<CardLayout content={content} domain={domain} />)}</body>`,
  ).window;
  return document.body.textContent ?? "";
};

describe("GET /r/<link>/og.png of the fixture link", () => {
  let server: WebServer;
  let card: Awaited<ReturnType<typeof fetchCard>>;

  beforeAll(async () => {
    server = await startServer();
    card = await fetchCard(server.url, fixture.link);
  }, buildTimeoutMs);

  afterAll(() => server.stop());

  it("is a 1200x630 PNG", () => {
    expect(card.response.status).toBe(200);
    expect(card.response.headers.get("content-type")).toBe("image/png");
    expect(pngSize(card.bytes)).toStrictEqual({
      height: 630,
      signature: pngSignature,
      width: 1200,
    });
  });

  it("is kept by the CDN and by browsers, for good", () => {
    expect(card.response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("draws the first image in under a second", () => {
    expect(card.elapsedMs).toBeLessThan(firstImageBudgetMs);
  });

  it("answers the same bytes for the same link", async () => {
    const again = await fetchCard(server.url, fixture.link);

    expect(again.bytes.equals(card.bytes)).toBeTruthy();
  });

  it("shows the first three Roast Lines of the page, word for word", async () => {
    const page = await fetch(`${server.url}/r/${fixture.link}`);
    const { document } = new JSDOM(await page.text()).window;
    const pageLines = [...document.querySelectorAll("[data-roast-line]")].map(
      (element) => element.textContent,
    );
    const content = await cardContentOf(fixture.link);

    const cardLines = result.cardLines.map(({ text }) => text);

    expect(content).toMatchObject({
      _tag: "Shared",
      lines: cardLines.map((text) => ({ text })),
    });
    expect(pageLines.slice(0, 3)).toStrictEqual(cardLines);
  });

  describe("of a broken link", () => {
    it("is still a 1200x630 PNG with a status of 200", async () => {
      const broken = await fetchCard(server.url, brokenLink);

      expect(broken.response.status).toBe(200);
      expect(broken.response.headers.get("content-type")).toBe("image/png");
      expect(pngSize(broken.bytes)).toStrictEqual({
        height: 630,
        signature: pngSignature,
        width: 1200,
      });
    });

    it("is not kept, like the broken-link page", async () => {
      const broken = await fetchCard(server.url, brokenLink);

      expect(broken.response.headers.get("cache-control")).toBe("no-store");
    });

    it("does not fail on a link that is not valid percent-encoding", async () => {
      const response = await fetch(`${server.url}/r/%E0%A4%A/og.png`);

      expect(response.status).toBeLessThan(500);
    });
  });
});

describe("the words of the card", () => {
  it("are the headline, the three Roast Lines, the domain and the command", async () => {
    const text = await textOf(fixture.link);

    expect(text).toContain(result.headline.figure);
    expect(text).toContain("tokens processed");
    for (const { text: line } of result.cardLines) {
      expect(text).toContain(line);
    }
    expect(text).toContain(domain);
    expect(text).toContain("npx tokenshame");
  });

  it("hold no cache word, no agent, no date range and no gap note", async () => {
    const words = await textOf(fixture.link);
    const text = words.toLowerCase();

    expect(text).not.toContain("cache");
    expect(text).not.toMatch(
      /claude|codex|cursor|copilot|gemini|goose|opencode|antigravity|muse|agent/u,
    );
    expect(text).not.toMatch(
      /\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/u,
    );
    expect(text).not.toMatch(/missing|gap|days? of/u);
  });

  it("say that the roast is broken, and how to get a new one, for a broken link", async () => {
    const text = await textOf(brokenLink);

    expect(text).toContain("this roast is broken");
    expect(text).toContain("npx tokenshame");
    expect(text).toContain(domain);
  });
});

// The card reads no stylesheet, so its tokens are copied. This keeps them equal to the Share Page's.
describe("the tokens of the card", () => {
  const css = readFileSync(new URL("../../../../index.css", import.meta.url), "utf-8");
  const token = (name: string) => css.match(new RegExp(`--ts-${name}:\\s*([^;]+);`, "u"))?.[1];

  it("are the colors of the Share Page", () => {
    expect(colors).toStrictEqual({
      bone: token("bg"),
      ink: token("ink"),
      mustard: token("mustard"),
      red: token("red"),
      redInk: token("red-ink"),
    });
  });

  it("are the display type of the Share Page", () => {
    expect(String(display.weight)).toBe(token("display-weight"));
    expect(tracking).toBe(token("display-tracking"));
    expect(String(display.leading)).toBe(token("display-leading"));
  });
});

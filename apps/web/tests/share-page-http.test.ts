import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { decode, encode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";

import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { siteOrigin, startServer } from "./http-harness";
import type { WebServer } from "./http-harness";

const buildTimeoutMs = 300_000;
const readme = "https://github.com/stefan-garofalo/tokenshame#how-we-calculate";
const summary = Effect.runSync(decode(fixture.link));
const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// The CLI cannot emit a link with no usage, but anyone can craft one.
const emptyLink = encode({ ...summary, models: [], other: none, sessions: 0 });

// Scripts never run: the DOM is the server-rendered HTML as a crawler or a no-JS visitor reads it.
const load = async (url: string) => {
  const response = await fetch(url);
  const html = await response.text();
  // A failed page fails once here, with what the server answered, instead of in every test.
  expect(
    response.status,
    `${url} answered ${response.headers.get("content-type")}: ${html.slice(0, 300)}`,
  ).toBe(200);
  const { document } = new JSDOM(html).window;
  return { document, html, response };
};

const content = (document: Document, selector: string) =>
  document.querySelector(selector)?.getAttribute("content") ?? null;

const anchorWith = (document: Document, text: string) =>
  [...document.querySelectorAll("a")].find((anchor) => anchor.textContent?.includes(text));

describe("Share Page as the server renders it", () => {
  let server: WebServer;

  beforeAll(async () => {
    server = await startServer();
  }, buildTimeoutMs);

  afterAll(() => server.stop());

  describe("of the fixture link", () => {
    let page: Awaited<ReturnType<typeof load>>;
    const pageUrl = `${siteOrigin}/r/${fixture.link}`;

    beforeAll(async () => {
      page = await load(`${server.url}/r/${fixture.link}`);
    });

    it("links Post on X to the X composer with the encoded Share Page URL", () => {
      const href = anchorWith(page.document, "Post on X")?.getAttribute("href") ?? "";
      const composer = new URL(href);

      expect(`${composer.origin}${composer.pathname}`).toBe("https://x.com/intent/post");
      expect(composer.searchParams.get("url")).toBe(pageUrl);
      expect(href).toContain(`url=${encodeURIComponent(pageUrl)}`);
    });

    it("falls back to an Open image link to the card where the image cannot be copied", () => {
      expect(anchorWith(page.document, "Open image")?.getAttribute("href")).toBe(
        `/r/${fixture.link}/og.png`,
      );
    });

    it("links the how-we-calculated note to the README section", () => {
      expect(anchorWith(page.document, "how we calculated")?.getAttribute("href")).toBe(readme);
    });

    it("shows the npx tokenshame box", () => {
      expect(page.document.querySelector("[data-command]")?.textContent).toBe("npx tokenshame");
    });

    it("shows the headline number and the Roast Lines", () => {
      expect(page.document.querySelector("h1")?.textContent).toContain("1,094,660,000");
      expect(page.document.querySelectorAll("[data-roast-line]").length).toBeGreaterThan(0);
    });

    it("shows no cache word or model id anywhere in the HTML", () => {
      const html = page.html.toLowerCase();

      expect(html).not.toContain("cache");
      for (const { model } of summary.models) {
        expect(html).not.toContain(model);
      }
    });

    it("shows no date range", () => {
      const markup = page.document.querySelector("main")?.outerHTML ?? "";

      expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
      expect(markup).not.toContain(summary.firstDay.slice(0, 4));
    });
  });

  describe("of a link with no usage", () => {
    let page: Awaited<ReturnType<typeof load>>;

    beforeAll(async () => {
      page = await load(`${server.url}/r/${emptyLink}`);
    });

    it("still renders with its title, description, card images and noindex", () => {
      expect(page.response.status).toBe(200);
      expect(page.document.title).toBe("0 tokens processed");
      expect(content(page.document, 'meta[name="description"]')).not.toBeNull();
      expect(content(page.document, 'meta[name="robots"]')).toBe("noindex");
    });

    it("points both card images at the link's card, as absolute addresses", () => {
      const image = `${siteOrigin}/r/${emptyLink}/og.png`;

      expect(content(page.document, 'meta[property="og:image"]')).toBe(image);
      expect(content(page.document, 'meta[name="twitter:image"]')).toBe(image);
      expect(content(page.document, 'meta[name="twitter:card"]')).toBe("summary_large_image");
    });

    it("shows the command and no cache word", () => {
      expect(page.document.querySelector("[data-command]")?.textContent).toBe("npx tokenshame");
      expect(page.html.toLowerCase()).not.toContain("cache");
    });
  });
});

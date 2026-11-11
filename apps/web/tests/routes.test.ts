import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { localEnv, productionHost, siteOrigin, startServer } from "./http-harness";
import type { WebServer } from "./http-harness";

const repoUrl = "https://github.com/stefan-garofalo/tokenshame";
const buildTimeoutMs = 300_000;
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

// Scripts never run: the DOM is the server-rendered HTML as a crawler reads it.
const loadPage = async (url: string) => {
  const response = await fetch(url);
  const { document } = new JSDOM(await response.text()).window;
  return { document, response };
};

const content = (document: Document, selector: string) =>
  document.querySelector(selector)?.getAttribute("content") ?? null;

// What varlock resolves for the site address, with or without a production host.
const siteOriginOf = async (productionUrl?: string) => {
  const env = localEnv();
  if (productionUrl !== undefined) {
    env.VERCEL_PROJECT_PRODUCTION_URL = productionUrl;
  }
  const { stdout } = await run("bunx", ["varlock", "load", "--format", "json"], {
    cwd: webRoot,
    env,
  });
  return JSON.parse(stdout).SITE_ORIGIN;
};

describe("web routes", () => {
  let server: WebServer;

  beforeAll(async () => {
    server = await startServer();
  }, buildTimeoutMs);

  afterAll(() => server.stop());

  it("GET / redirects 308 to the GitHub repo", async () => {
    const response = await fetch(`${server.url}/`, { redirect: "manual" });

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(repoUrl);
  });

  describe("/r/<link> of a valid link", () => {
    const image = `${siteOrigin}/r/${fixture.link}/og.png`;
    let page: Awaited<ReturnType<typeof loadPage>>;

    beforeAll(async () => {
      page = await loadPage(`${server.url}/r/${fixture.link}`);
    });

    it("responds with server-rendered HTML that the CDN keeps", () => {
      expect(page.response.status).toBe(200);
      expect(page.response.headers.get("content-type")).toContain("text/html");
      expect(page.response.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=31536000",
      );
    });

    it("has a title and a description", () => {
      expect(page.document.title).not.toBe("");
      expect(content(page.document, 'meta[name="description"]')).not.toBeNull();
    });

    it("has og tags with an absolute image", () => {
      expect(content(page.document, 'meta[property="og:title"]')).toBe(page.document.title);
      expect(content(page.document, 'meta[property="og:description"]')).not.toBeNull();
      expect(content(page.document, 'meta[property="og:type"]')).toBe("website");
      expect(content(page.document, 'meta[property="og:url"]')).toBe(
        `${siteOrigin}/r/${fixture.link}`,
      );
      expect(content(page.document, 'meta[property="og:image"]')).toBe(image);
    });

    it("has a large Twitter card with an absolute image", () => {
      expect(content(page.document, 'meta[name="twitter:card"]')).toBe("summary_large_image");
      expect(content(page.document, 'meta[name="twitter:image"]')).toBe(image);
    });

    it("stays out of search indexes", () => {
      expect(content(page.document, 'meta[name="robots"]')).toBe("noindex");
    });
  });

  describe("/r/<link> of a broken link", () => {
    let page: Awaited<ReturnType<typeof loadPage>>;

    beforeAll(async () => {
      page = await loadPage(`${server.url}/r/not-a-share-link`);
    });

    it("renders the broken-link message as HTML that is not kept", () => {
      expect(page.response.status).toBe(200);
      expect(page.response.headers.get("content-type")).toContain("text/html");
      expect(page.response.headers.get("cache-control")).toBe("no-store");
      expect(page.document.body.textContent).toContain("this roast is broken. Run npx tokenshame");
    });

    it("keeps noindex and points og:image at the link's card", () => {
      expect(content(page.document, 'meta[name="robots"]')).toBe("noindex");
      expect(content(page.document, 'meta[property="og:image"]')).toBe(
        `${siteOrigin}/r/not-a-share-link/og.png`,
      );
    });

    it("does not crash on a link that is not valid percent-encoding", async () => {
      const response = await fetch(`${server.url}/r/%E0%A4%A`);

      expect(response.status).toBeLessThan(500);
    });
  });
});

describe("site address", () => {
  it("is https on the production host from VERCEL_PROJECT_PRODUCTION_URL", async () => {
    await expect(siteOriginOf(productionHost)).resolves.toBe(siteOrigin);
  });

  it("is http://localhost:3001 in local development", async () => {
    await expect(siteOriginOf()).resolves.toBe("http://localhost:3001");
  });
});

import fixture from "@tokenshame/share-link/fixtures/v1.json";
import { decode, encode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { roast } from "../../../../server/roast";
import { shareRoute } from "./share-route";

const loadFixture = () => shareRoute.loader({ params: { link: fixture.link } });

interface MetaEntry {
  title?: string;
  content?: string;
  name?: string;
  property?: string;
}

const content = (meta: readonly MetaEntry[], key: "name" | "property", name: string) =>
  meta.find((entry) => entry[key] === name)?.content;

const summary = Effect.runSync(decode(fixture.link));

describe("share route loader", () => {
  it("sends the browser only what the page shows", async () => {
    const data = await loadFixture();
    const sent = JSON.stringify(data).toLowerCase();

    expect(data._tag).toBe("Shared");
    expect(sent).not.toContain("cache");
    for (const { model } of summary.models) {
      expect(sent).not.toContain(model);
    }
  });

  it("answers Broken for a link that does not decode", async () => {
    await expect(
      shareRoute.loader({ params: { link: "not-a-share-link" } }),
    ).resolves.toStrictEqual({ _tag: "Broken" });
  });
});

describe("share route head of the fixture link", () => {
  it("puts the roast headline in the title and the first Roast Line in the description", async () => {
    const loaderData = await loadFixture();
    const { meta } = shareRoute.head({ loaderData, params: { link: fixture.link } });
    const result = roast(summary);

    expect(content(meta, "property", "og:title")).toBe("1,094,660,000 tokens processed");
    expect(content(meta, "name", "twitter:title")).toBe(content(meta, "property", "og:title"));
    expect(content(meta, "name", "description")).toContain(result.lines[0].text);
    expect(content(meta, "property", "og:description")).toBe(content(meta, "name", "description"));
    expect(content(meta, "name", "twitter:description")).toBe(content(meta, "name", "description"));
  });

  it("never says cache and names no date", async () => {
    const loaderData = await loadFixture();
    const { meta } = shareRoute.head({ loaderData, params: { link: fixture.link } });
    const text = meta
      .map((entry) => entry.title ?? entry.content ?? "")
      .join(" ")
      .toLowerCase();

    expect(text).not.toContain("cache");
    expect(text).not.toContain(summary.firstDay.slice(0, 4));
  });

  it("points the card image at this link, as an absolute address", async () => {
    const loaderData = await loadFixture();
    const { meta } = shareRoute.head({ loaderData, params: { link: fixture.link } });

    expect(content(meta, "property", "og:image")).toMatch(
      new RegExp(`^https?://.+/r/${fixture.link}/og\\.png$`, "u"),
    );
    expect(content(meta, "name", "twitter:image")).toBe(content(meta, "property", "og:image"));
  });
});

describe("share route head of a broken link", () => {
  it("says the roast is broken and still points at the link's card", () => {
    const { meta } = shareRoute.head({ params: { link: "not-a-share-link" } });

    expect(content(meta, "property", "og:title")).toBe("this roast is broken");
    expect(content(meta, "property", "og:image")).toMatch(/\/r\/not-a-share-link\/og\.png$/u);
  });
});

// The CLI cannot emit a link with no usage, but anyone can craft one.
describe("share route of a link with no usage", () => {
  const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const link = encode({ ...summary, busiestHour: 0, models: [], other: none, sessions: 0 });
  const params = { link };

  const headOf = async () => {
    const loaderData = await shareRoute.loader({ params });
    return shareRoute.head({ loaderData, params }).meta;
  };

  it("is a shared roast with a zero headline in the title", async () => {
    const loaderData = await shareRoute.loader({ params });
    const { meta } = shareRoute.head({ loaderData, params });

    expect(loaderData._tag).toBe("Shared");
    expect(meta.find((entry) => entry.title !== undefined)?.title).toBe("0 tokens processed");
  });

  it("still has a description everywhere, without the word cache", async () => {
    const meta = await headOf();
    const description = content(meta, "name", "description");

    expect(description).toBeDefined();
    expect(description?.toLowerCase()).not.toContain("cache");
    expect(content(meta, "property", "og:description")).toBe(description);
    expect(content(meta, "name", "twitter:description")).toBe(description);
  });

  it("still has noindex and absolute card images", async () => {
    const meta = await headOf();

    expect(content(meta, "name", "robots")).toBe("noindex");
    expect(content(meta, "property", "og:image")).toMatch(/^https?:\/\/.+\/og\.png$/u);
    expect(content(meta, "name", "twitter:image")).toBe(content(meta, "property", "og:image"));
  });
});

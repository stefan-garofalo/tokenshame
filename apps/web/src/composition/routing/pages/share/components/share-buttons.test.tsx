// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyImageButton } from "./copy-image-button";
import { PostOnXButton } from "./post-on-x-button";

const pageUrl = "https://tokenshame.test/r/abc_DEF-123";
const imageUrl = "/r/abc_DEF-123/og.png";
const text = "12.3B tokens processed. Roasted by tokenshame.";

// jsdom has no clipboard, ClipboardItem or fetch that serves the card, so the browser parts are stubs.
class FakeClipboardItem {
  readonly items: Record<string, Promise<Blob>>;
  constructor(items: Record<string, Promise<Blob>>) {
    this.items = items;
  }
}

type Write = (items: FakeClipboardItem[]) => Promise<void>;

const stubBrowser = (write: Write) => {
  const card = new Response(new Blob(["png"]), { headers: { "content-type": "image/png" } });
  vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(card));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
};

describe("share buttons", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  describe(PostOnXButton, () => {
    it("links to the X post composer with the Share Page URL, in a new tab", () => {
      render(<PostOnXButton pageUrl={pageUrl} text={text} />);

      const link = screen.getByRole("link", { name: /post on x/iu });

      expect(link.getAttribute("href")).toBe(
        `https://x.com/intent/post?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`,
      );
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });
  });

  describe(CopyImageButton, () => {
    it("renders without script as a link to the image", () => {
      const html = renderToStaticMarkup(<CopyImageButton imageUrl={imageUrl} />);

      expect(html).toContain(`href="${imageUrl}"`);
      expect(html).not.toContain("<button");
    });

    it("writes the Share Card as an image/png clipboard item", async () => {
      const write = vi.fn<Write>().mockResolvedValue();
      stubBrowser(write);
      render(<CopyImageButton imageUrl={imageUrl} />);

      fireEvent.click(screen.getByRole("button", { name: /copy image/iu }));

      await expect(screen.findByRole("button", { name: /copied/iu })).resolves.toBeTruthy();
      expect(fetch).toHaveBeenCalledWith(imageUrl);
      expect(write).toHaveBeenCalledOnce();
      const [[[item]]] = write.mock.calls;
      expect(Object.keys(item.items)).toStrictEqual(["image/png"]);
      const { "image/png": pending } = item.items;
      const blob = await pending;
      expect(blob.type).toBe("image/png");
    });

    it("says the copy failed and offers the image as a link", async () => {
      const write = vi.fn<Write>().mockRejectedValue(new Error("denied"));
      stubBrowser(write);
      render(<CopyImageButton imageUrl={imageUrl} />);

      fireEvent.click(screen.getByRole("button", { name: /copy image/iu }));

      const fallback = await screen.findByRole("link", { name: /copy failed/iu });
      expect(fallback.getAttribute("href")).toBe(imageUrl);
    });

    it("offers the image as a link when the browser cannot copy images", () => {
      render(<CopyImageButton imageUrl={imageUrl} />);

      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByRole("link", { name: /open image/iu }).getAttribute("href")).toBe(
        imageUrl,
      );
    });
  });
});

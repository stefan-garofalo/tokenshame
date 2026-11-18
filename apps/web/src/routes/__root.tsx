import { createRootRouteWithContext } from "@tanstack/react-router";

import { RootDocument } from "../composition/routing";
import appCss from "../index.css?url";

export type RouterAppContext = Record<string, never>;

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootDocument,
  head: () => ({
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1, viewport-fit=cover", name: "viewport" },
      // The browser chrome takes the page's top colour: Omarchy Matte Black, or Flexoki Light.
      { content: "#090909", media: "(prefers-color-scheme: dark)", name: "theme-color" },
      { content: "#fffcf0", media: "(prefers-color-scheme: light)", name: "theme-color" },
      { content: "dark light", name: "color-scheme" },
      { title: "tokenshame" },
    ],
  }),
});

import { decode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";

import { ENV } from "../../../../env";
import { roast } from "../../../../server/roast";
import display from "./fonts/epilogue-latin-900.woff2?url";
import { command } from "./links";
import { RoutePage } from "./route-page";
import type { ShareView } from "./share-page";

type ShareLoaderData = ({ readonly _tag: "Shared" } & ShareView) | { readonly _tag: "Broken" };

interface LinkParams {
  readonly link: string;
}

const cardWidth = "1200";
const cardHeight = "630";
const brokenTitle = "this roast is broken";
const brokenDescription = `Run ${command} to get your own roast.`;

// Only what the page shows goes to the browser: the loader result is embedded in the HTML.
const loader = ({ params }: { params: LinkParams }) =>
  Effect.runPromise(
    decode(params.link).pipe(
      Effect.match({
        onFailure: (): ShareLoaderData => ({ _tag: "Broken" }),
        onSuccess: (summary): ShareLoaderData => {
          const { cost, headline, lines } = roast(summary);
          return { _tag: "Shared", cost, headline, lines };
        },
      }),
    ),
  );

const titleAndDescription = (data?: ShareLoaderData) => {
  if (data?._tag !== "Shared") {
    return { description: brokenDescription, title: brokenTitle };
  }
  const [first] = data.lines;
  return {
    description: `${first.text} Run ${command} to get yours.`,
    title: `${data.headline.figure} ${data.headline.label}`,
  };
};

const head = ({ loaderData, params }: { loaderData?: ShareLoaderData; params: LinkParams }) => {
  const page = `${ENV.SITE_ORIGIN}/r/${encodeURIComponent(params.link)}`;
  const image = `${page}/og.png`;
  const { description, title } = titleAndDescription(loaderData);
  return {
    links: [
      {
        as: "font",
        crossOrigin: "anonymous" as const,
        href: display,
        rel: "preload",
        type: "font/woff2",
      },
    ],
    meta: [
      { title },
      { content: description, name: "description" },
      { content: "noindex", name: "robots" },
      { content: title, property: "og:title" },
      { content: description, property: "og:description" },
      { content: "website", property: "og:type" },
      { content: page, property: "og:url" },
      { content: image, property: "og:image" },
      { content: cardWidth, property: "og:image:width" },
      { content: cardHeight, property: "og:image:height" },
      { content: "summary_large_image", name: "twitter:card" },
      { content: title, name: "twitter:title" },
      { content: description, name: "twitter:description" },
      { content: image, name: "twitter:image" },
    ],
  };
};

// A valid link never changes, so the CDN keeps its page until the next deploy; a broken one is never kept.
const headers = ({ loaderData }: { loaderData?: ShareLoaderData }) => ({
  "Cache-Control":
    loaderData?._tag === "Shared" ? "public, max-age=0, s-maxage=31536000" : "no-store",
});

export const shareRoute = {
  component: RoutePage,
  head,
  headers,
  loader,
};

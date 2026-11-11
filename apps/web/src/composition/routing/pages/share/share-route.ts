import { getRouteApi } from "@tanstack/react-router";
import { decode } from "@tokenshame/share-link/link";
import type { Summary } from "@tokenshame/share-link/summary";
import * as Effect from "effect/Effect";
import { createElement } from "react";

import { ENV } from "../../../../env";

type ShareLoaderData =
  | { readonly _tag: "Shared"; readonly summary: Summary }
  | { readonly _tag: "Broken" };

interface LinkParams {
  readonly link: string;
}

const title = "tokenshame roast";
const description = "A usage roast from tokenshame. Run npx tokenshame to get yours.";
const cardWidth = "1200";
const cardHeight = "630";

const loader = ({ params }: { params: LinkParams }) =>
  Effect.runPromise(
    decode(params.link).pipe(
      Effect.match({
        onFailure: (): ShareLoaderData => ({ _tag: "Broken" }),
        onSuccess: (summary): ShareLoaderData => ({
          _tag: "Shared",
          summary,
        }),
      }),
    ),
  );

const head = ({ params }: { params: LinkParams }) => {
  const page = `${ENV.SITE_ORIGIN}/r/${encodeURIComponent(params.link)}`;
  const image = `${page}/og.png`;
  return {
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
      { content: image, name: "twitter:image" },
    ],
  };
};

// A valid link never changes, so the CDN keeps its page until the next deploy; a broken one is never kept.
const headers = ({ loaderData }: { loaderData?: ShareLoaderData }) => ({
  "Cache-Control":
    loaderData?._tag === "Shared" ? "public, max-age=0, s-maxage=31536000" : "no-store",
});

const routeApi = getRouteApi("/r/$link");

const SharePage = () => {
  const data = routeApi.useLoaderData();
  return createElement(
    "main",
    null,
    data._tag === "Shared"
      ? createElement("h1", null, title)
      : createElement(
          "p",
          null,
          "this roast is broken. Run ",
          createElement("code", null, "npx tokenshame"),
        ),
  );
};

export const shareRoute = {
  component: SharePage,
  head,
  headers,
  loader,
};

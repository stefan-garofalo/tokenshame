import { fontFromDataUrl, pngResponse } from "../../../../integrations/takumi";
import { ENV } from "../../../../env";
import display from "../share/fonts/epilogue-latin-900.woff2?inline";
import text from "../share/fonts/epilogue-latin-500.woff2?inline";
import { cardContentOf } from "./card-content";
import type { CardContent } from "./card-content";
import { CardLayout } from "./card-layout";
import { card, display as displayType, family, textWeight } from "./card-tokens";

const fonts = [
  fontFromDataUrl(family, displayType.weight, display),
  fontFromDataUrl(family, textWeight, text),
];

// A valid link never changes, so its card is kept for good. A broken link gets no stored copy, like its page.
const cacheControl = (content: CardContent) =>
  content._tag === "Shared" ? "public, max-age=31536000, immutable" : "no-store";

/** The Share Card of one Share Link, a 1200x630 PNG. A link that does not decode gets a generic card. */
export const shareCardResponse = async (link: string): Promise<Response> => {
  const content = await cardContentOf(link);
  return pngResponse(
    <CardLayout content={content} domain={new URL(ENV.SITE_ORIGIN).host} />,
    card.width,
    card.height,
    fonts,
    { "Cache-Control": cacheControl(content) },
  );
};

import { decode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";

import { roast } from "../../../../server/roast";

/** One Roast Line of the card: the sentence, and the part of it that is the number. */
export interface CardLine {
  readonly text: string;
  readonly quantity: string;
}

/** What the card says for one Share Link. A link that does not decode gets the generic card. */
export type CardContent =
  | {
      readonly _tag: "Shared";
      readonly figure: string;
      readonly label: string;
      readonly lines: readonly CardLine[];
    }
  | { readonly _tag: "Broken" };

/** The card's words come from the same `roast` call as the page, so the two always agree. */
export const cardContentOf = (link: string): Promise<CardContent> =>
  Effect.runPromise(
    decode(link).pipe(
      Effect.match({
        onFailure: (): CardContent => ({ _tag: "Broken" }),
        onSuccess: (summary): CardContent => {
          const { cardLines, headline } = roast(summary);
          return {
            _tag: "Shared",
            figure: headline.figure,
            label: headline.label,
            lines: cardLines.map(({ figure, text, unit }) => ({
              quantity: `${figure} ${unit}`,
              text,
            })),
          };
        },
      }),
    ),
  );

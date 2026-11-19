import { decode } from "@tokenshame/share-link/link";
import * as Effect from "effect/Effect";

import { roast } from "../../../../server/roast";
import type { Kpi } from "../../../../server/roast";

/** One KPI tile of the card: the figure, its unit, and the tile's label and quip. */
export type CardKpi = Pick<Kpi, "figure" | "id" | "tile" | "unit">;

/** What the card says for one Share Link. A link that does not decode gets the generic card. */
export type CardContent =
  | {
      readonly _tag: "Shared";
      readonly figure: string;
      readonly label: string;
      readonly kpis: readonly CardKpi[];
    }
  | { readonly _tag: "Broken" };

/** The card's words come from the same `roast` call as the page, so the two always agree. */
export const cardContentOf = (link: string): Promise<CardContent> =>
  Effect.runPromise(
    decode(link).pipe(
      Effect.match({
        onFailure: (): CardContent => ({ _tag: "Broken" }),
        onSuccess: (summary): CardContent => {
          const { headline, kpis } = roast(summary);
          return {
            _tag: "Shared",
            figure: headline.figure,
            label: headline.label,
            kpis: kpis.map(({ figure, id, tile, unit }) => ({ figure, id, tile, unit })),
          };
        },
      }),
    ),
  );

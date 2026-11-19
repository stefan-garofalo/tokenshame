import type { Roast } from "../../../../../server/roast";
import { fitFontSize } from "../fit-width";
import { command } from "../links";

/**
 * The month in one picture: the full token count and the KPIs as tiles, each on its slide's colour.
 * The Share Card draws the same board as a PNG.
 */
export const Bento = ({ headline, kpis }: Pick<Roast, "headline" | "kpis">) => (
  <div className="bento">
    <div className="bento-tile bento-tokens">
      <p className="bento-count" style={{ fontSize: fitFontSize(headline.figure) }}>
        {headline.figure}
      </p>
      <p>{headline.label} in 30 days</p>
    </div>
    {kpis.map(({ figure, id, tile, unit }) => (
      <div className={`bento-tile field-${id}`} key={id}>
        <p className="bento-figure">{figure}</p>
        <p>
          {unit} {tile.label}
        </p>
        <p className="bento-quip">{tile.quip}</p>
      </div>
    ))}
    <div className="bento-tile bento-foot">
      <span>cry about it.</span>
      <span>{command}</span>
    </div>
  </div>
);

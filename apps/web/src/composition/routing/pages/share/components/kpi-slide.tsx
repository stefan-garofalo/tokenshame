import type { Kpi } from "../../../../../server/roast";
import { fitFontSize } from "../fit-width";
import { pictures } from "../pictures";
import { NextLink } from "./next-link";

// The figure grows with the slide's width until it would crowd the words under it.
const maxFigure = "42svh";

/**
 * One KPI as a full-screen slide on its own field of colour: the figure as large as the slide
 * allows, a picture of what it costs, what it is of, and the Roast Line that rubs it in.
 */
export const KpiSlide = ({ kpi, next }: { kpi: Kpi; next: string }) => {
  const picture = pictures.get(kpi.id);
  return (
    <section
      aria-labelledby={`${kpi.id}-title`}
      className={`slide slide-kpi field-${kpi.id}`}
      id={kpi.id}
    >
      {picture && (
        <div className="kpi-picture">
          <img
            alt={picture.alt}
            height={picture.height}
            loading="lazy"
            src={picture.src}
            width={picture.width}
          />
        </div>
      )}
      <div aria-hidden="true" className="kpi-figure">
        <span style={{ fontSize: fitFontSize(kpi.figure, 100, maxFigure) }}>{kpi.figure}</span>
      </div>
      <div className="kpi-body">
        <h2 className="kpi-title" id={`${kpi.id}-title`}>
          {kpi.unit} {kpi.tile.label}
        </h2>
        <p className="kpi-text" data-roast-line>
          {kpi.text}
        </p>
        <NextLink href={next} />
      </div>
    </section>
  );
};

import type { RoastLine } from "../../../../../server/roast";
import { pictures } from "../pictures";
import { NextLink } from "./next-link";

/**
 * The Roast Lines that are not KPIs, in engine order: the figure, the sentence, and a picture of
 * what it compares with when there is one.
 */
export const RoastList = ({ lines, next }: { lines: readonly RoastLine[]; next: string }) => (
  <section aria-labelledby="log-title" className="slide log" id="damage">
    <h2 className="log-title" id="log-title">
      The rest of the damage
    </h2>
    <ol className="log-list">
      {lines.map(({ figure, id, text, unit }) => {
        const picture = pictures.get(id);
        return (
          <li className="roast" key={id}>
            {picture && (
              <figure className="shot">
                <img
                  alt={picture.alt}
                  className="shot-picture"
                  height={picture.height}
                  loading="lazy"
                  src={picture.src}
                  width={picture.width}
                />
                <figcaption className="shot-strip">
                  <span>{id}.jpg</span>
                  <span>{picture.licence}</span>
                </figcaption>
              </figure>
            )}
            <div className="roast-body">
              <p aria-hidden="true" className="roast-figure">
                <span className="roast-number">{figure}</span>
                <span className="roast-unit">{unit}</span>
              </p>
              <p className="roast-text" data-roast-line>
                {text}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
    <NextLink href={next} />
  </section>
);

import type { RoastLine } from "../../../../../server/roast";
import { pictures } from "../pictures";

/** Every Roast Line, most dreadful first: its figure shouted on the left, the sentence beside it. */
export const RoastList = ({ lines }: { lines: readonly RoastLine[] }) => (
  <section className="warnings" aria-labelledby="warnings-title">
    <h2 className="sr-only" id="warnings-title">
      Side effects
    </h2>
    <ul>
      {lines.map(({ figure, id, text, unit }) => {
        const picture = pictures.get(id);
        return (
          <li className="warning" key={id}>
            <p aria-hidden="true" className="warning-figure">
              <span className="warning-number">{figure}</span>
              <span className="warning-unit">{unit}</span>
            </p>
            <div className="warning-body">
              <p className="warning-text" data-roast-line>
                {text}
              </p>
              {picture && (
                <div className="warning-frame">
                  <img
                    alt={picture.alt}
                    className="warning-picture"
                    height={600}
                    loading="lazy"
                    src={picture.src}
                    width={960}
                  />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  </section>
);

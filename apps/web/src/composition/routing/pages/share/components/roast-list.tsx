import type { RoastLine } from "../../../../../server/roast";
import { fitFontSize } from "../fit-width";
import { pictures } from "../pictures";
import { Bar } from "./bar";

/** Every Roast Line, most dreadful first: one pane of output each, its figure on top, the sentence under it. */
export const RoastList = ({ lines }: { lines: readonly RoastLine[] }) => (
  <section aria-labelledby="log-title" className="log">
    <div className="pane log-head">
      <Bar tag={`${lines.length}`} title="side-effects" />
      <h2 id="log-title">
        {lines.length} side {lines.length === 1 ? "effect" : "effects"}, worst first.
      </h2>
      <p>Your token count, converted into things that exist.</p>
    </div>
    <ul className="log-list">
      {lines.map(({ figure, id, text, unit }, index) => {
        const picture = pictures.get(id);
        return (
          <li className="pane roast" key={id}>
            <Bar title={`out ${index + 1}/${lines.length}`} />
            <div className="roast-body">
              <p aria-hidden="true" className="roast-figure">
                <span
                  className="roast-number"
                  style={picture ? undefined : { fontSize: fitFontSize(figure, 60) }}
                >
                  {figure}
                </span>
                <span className="roast-unit">{unit}</span>
              </p>
              <p className="roast-text" data-roast-line>
                {text}
              </p>
            </div>
            {picture && (
              <figure className="shot">
                <img
                  alt={picture.alt}
                  className="shot-picture"
                  height={600}
                  loading="lazy"
                  src={picture.src}
                  width={960}
                />
                <figcaption className="shot-strip">
                  <span>{id}.jpg</span>
                  <span>{picture.licence}</span>
                </figcaption>
              </figure>
            )}
          </li>
        );
      })}
    </ul>
  </section>
);

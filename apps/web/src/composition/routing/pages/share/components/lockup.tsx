import { Fragment } from "react";

import { fitFontSize } from "../fit-width";

/**
 * The headline as a lockup: every line is sized to span the full width, like a name on a pack.
 * A line is one `<span>`; the spaces between keep the headline readable as one sentence.
 */
export const Lockup = ({ lines }: { lines: readonly string[] }) => (
  <h1 className="lockup">
    {lines.map((line, index) => (
      <Fragment key={line}>
        {index > 0 && " "}
        <span
          className="mask"
          style={{ animationDelay: `calc(${index} * 110ms + 150ms)`, fontSize: fitFontSize(line) }}
        >
          <span className="rise">{line}</span>
        </span>
      </Fragment>
    ))}
  </h1>
);

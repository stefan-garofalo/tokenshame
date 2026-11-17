import { command } from "../links";

/** The shell line that made the page, as decoration: it types itself in, then a caret blinks. */
export const Prompt = () => (
  <p aria-hidden="true" className="prompt">
    <span className="prompt-sign">$</span> <span className="typed">{command}</span>
    <span className="caret" />
  </p>
);

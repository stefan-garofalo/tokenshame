import { command } from "../links";

/** The shell line that made the page: the product's own interface, so it carries `data-ui`. It types itself in, then a caret blinks. */
export const Prompt = () => (
  <p aria-hidden="true" className="prompt" data-ui>
    <span className="prompt-sign">$</span> <span className="typed">{command}</span>
    <span className="caret" />
  </p>
);

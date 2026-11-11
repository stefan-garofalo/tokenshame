import { CommandBox } from "./command-box";

export const RunYourOwn = () => (
  <section className="run" aria-labelledby="run-title">
    <h2 className="section-title" id="run-title">
      Your turn
    </h2>
    <p className="run-text">
      Run this in a terminal. It reads your local usage, shows you the numbers and asks before it
      opens anything.
    </p>
    <CommandBox />
  </section>
);

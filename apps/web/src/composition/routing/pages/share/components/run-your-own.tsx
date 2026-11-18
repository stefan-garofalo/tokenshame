import { CommandBox } from "./command-box";

/** The close: the command sits inside the sentence that asks for it. */
export const RunYourOwn = () => (
  <section aria-labelledby="run-title" className="run" id="run">
    <h2 className="run-title" id="run-title">
      <span className="run-verb">Run </span>
      <CommandBox />
    </h2>
    <p className="run-text">
      It reads the usage logs your coding agents already keep on your machine and shows your own
      last 30 days.
    </p>
  </section>
);

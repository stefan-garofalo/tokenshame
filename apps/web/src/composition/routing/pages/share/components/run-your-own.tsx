import { CommandBox } from "./command-box";

export const RunYourOwn = () => (
  <section aria-labelledby="run-title" className="run">
    <div className="pane pane-lime run-main">
      <h2 className="run-title" id="run-title">
        Get your own roast.
      </h2>
      <p className="run-text">
        Run this in a terminal. It reads your local usage, shows you the numbers and asks before it
        opens anything.
      </p>
    </div>
    <div className="pane pane-black run-command">
      <CommandBox />
    </div>
  </section>
);

import { Bar } from "./bar";
import { CommandBox } from "./command-box";

export const RunYourOwn = () => (
  <section aria-labelledby="run-title" className="run">
    <div className="pane run-main">
      <Bar title="next" />
      <h2 className="run-title" id="run-title">
        Get your own roast.
      </h2>
      <p className="run-text">
        Run this in a terminal. It reads your local usage, shows you the numbers and asks before it
        opens anything.
      </p>
    </div>
    <div className="pane pane-raised run-command">
      <Bar tag="zsh" title="run" />
      <CommandBox />
    </div>
  </section>
);

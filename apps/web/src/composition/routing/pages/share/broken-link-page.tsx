import { CommandBox } from "./components/command-box";
import { Lockup } from "./components/lockup";
import { Prompt } from "./components/prompt";
import { command, repoUrl } from "./links";
import "./share.css";

/** Shown for a link that does not decode. It sends the visitor to get a fresh roast. */
export const BrokenLinkPage = () => (
  <main className="share board broken">
    <section className="hero">
      <div className="pane pane-lime pane-name">
        <Prompt />
        <Lockup lines={["this roast is broken.", `Run ${command}`]} />
      </div>
      <div className="pane pane-statement">
        <a className="wordmark" href={repoUrl}>
          tokenshame
        </a>
        <p className="statement">The link is damaged or cut short. One command makes a new one.</p>
        <CommandBox />
      </div>
    </section>
  </main>
);

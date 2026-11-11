import { CommandBox } from "./components/command-box";
import { Lockup } from "./components/lockup";
import { command, repoUrl } from "./links";
import "./share.css";

/** Shown for a link that does not decode. It sends the visitor to get a fresh roast. */
export const BrokenLinkPage = () => (
  <main className="broken">
    <section className="hero">
      <a className="wordmark" href={repoUrl}>
        tokenshame
      </a>
      <Lockup lines={["this roast is broken.", `Run ${command}`]} />
      <div className="hero-foot">
        <p className="hero-note">The link is damaged or cut short. One command makes a new one.</p>
        <CommandBox />
      </div>
    </section>
  </main>
);

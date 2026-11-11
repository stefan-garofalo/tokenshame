import type { Roast } from "../../../../server/roast";
import { Bill } from "./components/bill";
import { CopyImageSlot } from "./components/copy-image-slot";
import { Credits } from "./components/credits";
import { Lockup } from "./components/lockup";
import { PostOnXSlot } from "./components/post-on-x-slot";
import { RoastList } from "./components/roast-list";
import { RunYourOwn } from "./components/run-your-own";
import { SiteFooter } from "./components/site-footer";
import { repoUrl } from "./links";
import "./share.css";

/** What the Share Page needs from the roast engine. */
export type ShareView = Pick<Roast, "cost" | "headline" | "lines">;

/** The Share Page of one Share Link: the headline number, the Roast Lines, the cost, how to run your own. */
export const SharePage = ({ roast }: { roast: ShareView }) => (
  <main className="share">
    <section className="hero">
      <a className="wordmark" href={repoUrl}>
        tokenshame
      </a>
      <Lockup lines={[roast.headline.figure, roast.headline.label]} />
      <div className="hero-foot">
        <p className="hero-note">
          That is what your coding agents chewed through. The side effects are listed below.
        </p>
        <div className="actions">
          <PostOnXSlot />
          <CopyImageSlot />
        </div>
      </div>
    </section>
    <RoastList lines={roast.lines} />
    <Bill cost={roast.cost} />
    <RunYourOwn />
    <SiteFooter>
      <Credits />
    </SiteFooter>
  </main>
);

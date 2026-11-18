import { useRouter } from "@tanstack/react-router";

import { ENV } from "../../../../env";
import type { Roast } from "../../../../server/roast";
import { CopyImageButton } from "./components/copy-image-button";
import { CopyImageSlot } from "./components/copy-image-slot";
import { Credits } from "./components/credits";
import { Hours } from "./components/hours";
import { HowWeCalculated } from "./components/how-we-calculated";
import { Lockup } from "./components/lockup";
import { MonthFile } from "./components/month-file";
import { PostOnXButton } from "./components/post-on-x-button";
import { PostOnXSlot } from "./components/post-on-x-slot";
import { Prompt } from "./components/prompt";
import { RoastList } from "./components/roast-list";
import { RunYourOwn } from "./components/run-your-own";
import { SiteFooter } from "./components/site-footer";
import { repoUrl } from "./links";
import "./share.css";

/** What the Share Page needs from the roast engine. */
export type ShareView = Pick<Roast, "cost" | "headline" | "lines" | "month">;

// The Share Page is the page the visitor is on. Without a router (a bare render) there is nothing to share yet.
const useSharePath = () => useRouter({ warn: false })?.state.location.pathname;

/** The top bar: the name, and where the numbers come from. */
export const Nav = () => (
  <nav aria-label="tokenshame" className="nav">
    <a className="wordmark" href={repoUrl}>
      tokenshame
    </a>
    <span className="nav-links">
      <HowWeCalculated />
      <a href={repoUrl}>GitHub</a>
    </span>
  </nav>
);

/**
 * The Share Page of one Share Link: the month's token count beside the month as a source file,
 * the cost in hours of the visitor's pay, the Roast Lines, and the command to run your own.
 */
export const SharePage = ({ roast }: { roast: ShareView }) => {
  const sharePath = useSharePath();
  const { figure, label } = roast.headline;
  const hasLines = roast.lines.length > 0;

  return (
    <main className="share">
      <Nav />
      <section className="hero">
        <div className="hero-text">
          <Prompt />
          <Lockup lines={[figure, label]} />
          <p className="statement">
            {hasLines
              ? "What your coding agents got through in the last 30 days."
              : "Nothing to roast: no usage in the last 30 days."}
          </p>
          <div className="actions">
            <PostOnXSlot>
              {sharePath && (
                <PostOnXButton
                  pageUrl={`${ENV.SITE_ORIGIN}${sharePath}`}
                  text={`My coding agents processed ${figure} tokens in the last 30 days.`}
                />
              )}
            </PostOnXSlot>
            <CopyImageSlot>
              {sharePath && <CopyImageButton imageUrl={`${sharePath}/og.png`} />}
            </CopyImageSlot>
          </div>
        </div>
        <div className="stage">
          <MonthFile cost={roast.cost} headline={roast.headline} month={roast.month} />
        </div>
      </section>
      {hasLines && <Hours cost={roast.cost} />}
      {hasLines && <RoastList lines={roast.lines} />}
      <RunYourOwn />
      <SiteFooter busiestHour={hasLines ? roast.month.busiestHour : undefined}>
        {hasLines && <Credits />}
      </SiteFooter>
    </main>
  );
};

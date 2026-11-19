import { useRouter } from "@tanstack/react-router";

import { ENV } from "../../../../env";
import type { Roast } from "../../../../server/roast";
import { Bento } from "./components/bento";
import { CopyImageButton } from "./components/copy-image-button";
import { CopyImageSlot } from "./components/copy-image-slot";
import { Credits } from "./components/credits";
import { Hours } from "./components/hours";
import { HowWeCalculated } from "./components/how-we-calculated";
import { KpiSlide } from "./components/kpi-slide";
import { Lockup } from "./components/lockup";
import { NextLink } from "./components/next-link";
import { PostOnXButton } from "./components/post-on-x-button";
import { PostOnXSlot } from "./components/post-on-x-slot";
import { Prompt } from "./components/prompt";
import { RoastList } from "./components/roast-list";
import { RunYourOwn } from "./components/run-your-own";
import { SiteFooter } from "./components/site-footer";
import { repoUrl } from "./links";
import "./share.css";

/** What the Share Page needs from the roast engine. */
export type ShareView = Pick<Roast, "cost" | "headline" | "kpis" | "month" | "rest">;

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

/** What the Post on X button writes: the water, if there is any, said like a villain. */
const postText = ({ headline, kpis }: ShareView): string => {
  const water = kpis.find(({ id }) => id === "water");
  return water
    ? `I made AI drink ${water.figure} ${water.unit} of water this month. Cry about it 💧`
    : `My AI processed ${headline.figure} tokens in 30 days. Suspiciously clean.`;
};

/**
 * The Share Page of one Share Link, as a Wrapped: one full-screen slide per chapter, snapped as
 * the visitor scrolls. The token count, a slide per KPI, the rest of the damage, the hours of pay,
 * and the bento to post. Every "Next" is an anchor, so it works without script.
 */
export const SharePage = ({ roast }: { roast: ShareView }) => {
  const sharePath = useSharePath();
  const { figure, label } = roast.headline;
  const hasLines = roast.kpis.length > 0 || roast.rest.length > 0;
  const order = [
    ...roast.kpis.map(({ id }) => id),
    ...(roast.rest.length > 0 ? ["damage"] : []),
    ...(hasLines ? ["hours"] : []),
    "receipt",
  ];
  const after = (index: number) => `#${order[index] ?? "receipt"}`;

  return (
    <main className="share wrapped">
      <div aria-hidden="true" className="progress" />
      <section aria-label="Your month" className="slide slide-start">
        <Nav />
        <div className="start-body">
          <Prompt />
          <p className="statement">
            {hasLines
              ? "Your last 30 days with AI, wrapped. Scroll if you can take it."
              : "Nothing to roast: no usage in the last 30 days. Suspiciously clean."}
          </p>
          <Lockup lines={[figure, label]} />
          <p className="start-facts">
            {roast.month.sessions.toLocaleString("en-US")} sessions. Zero regrets.
          </p>
          <NextLink href={after(0)} label={hasLines ? "Unwrap it" : "Get the image"} />
        </div>
      </section>
      {roast.kpis.map((kpi, index) => (
        <KpiSlide key={kpi.id} kpi={kpi} next={after(index + 1)} />
      ))}
      {roast.rest.length > 0 && <RoastList lines={roast.rest} next="#hours" />}
      {hasLines && <Hours cost={roast.cost} next="#receipt" />}
      <section aria-labelledby="receipt-title" className="slide slide-receipt" id="receipt">
        <h2 className="receipt-title" id="receipt-title">
          Your month in one picture.
        </h2>
        <Bento headline={roast.headline} kpis={roast.kpis} />
        <div className="actions">
          <PostOnXSlot>
            {sharePath && (
              <PostOnXButton pageUrl={`${ENV.SITE_ORIGIN}${sharePath}`} text={postText(roast)} />
            )}
          </PostOnXSlot>
          <CopyImageSlot>
            {sharePath && <CopyImageButton imageUrl={`${sharePath}/og.png`} />}
          </CopyImageSlot>
        </div>
      </section>
      <div className="close">
        <RunYourOwn />
        <SiteFooter busiestHour={hasLines ? roast.month.busiestHour : undefined}>
          {hasLines && <Credits />}
        </SiteFooter>
      </div>
    </main>
  );
};

import type { ReactNode } from "react";

import { fitFontSize } from "../fit-width";
import { npmUrl, repoUrl } from "../links";
import { HowWeCalculated } from "./how-we-calculated";
import { clock } from "../clock";

const name = "tokenshame";

/** The close: a board of tiles, the name again at full width, and the way back to the command. */
export const SiteFooter = ({
  busiestHour,
  children,
}: {
  busiestHour?: number;
  children?: ReactNode;
}) => (
  <footer className="footer">
    <div className="tile tile-note">
      <p>
        The link holds your numbers and nothing else. Your prompts stay private. Your shame does
        not.
      </p>
    </div>
    <nav aria-label="More about tokenshame" className="tile tile-nav">
      <ul>
        <li>
          <HowWeCalculated />
        </li>
        <li>
          <a href={repoUrl}>Source on GitHub</a>
        </li>
        <li>
          <a href={npmUrl}>tokenshame on npm</a>
        </li>
      </ul>
    </nav>
    {busiestHour !== undefined && (
      <div className="tile tile-hour">
        <p>
          Peak shame hour: <span className="tok-num">{clock(busiestHour)}</span>.
        </p>
      </div>
    )}
    <a className="tile tile-mark" href={repoUrl}>
      <span style={{ fontSize: fitFontSize(name, 92) }}>{name}</span>
    </a>
    <a className="tile tile-go" href="#run">
      <span>Get roasted</span>
      <svg aria-hidden="true" className="tile-arrow" viewBox="0 0 48 48">
        <path d="M10 38 38 10M16 10h22v22" />
      </svg>
    </a>
    {children}
  </footer>
);

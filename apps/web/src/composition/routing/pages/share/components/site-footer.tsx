import type { ReactNode } from "react";

import { fitFontSize } from "../fit-width";
import { repoUrl } from "../links";
import { Bar } from "./bar";

const name = "tokenshame";

/** The close: one honest sentence about what the link holds, and the name again at full width. */
export const SiteFooter = ({ children }: { children?: ReactNode }) => (
  <footer className="footer">
    <div className="pane footer-note-pane">
      <Bar title="privacy" />
      <p className="footer-note">
        The link carries the numbers and nothing else. No prompts, no account.
      </p>
    </div>
    <div className="pane pane-raised footer-links-pane">
      <Bar title="source" />
      <a href={repoUrl}>Source on GitHub</a>
    </div>
    <div className="pane footer-mark-pane">
      <a className="footer-mark" href={repoUrl} style={{ fontSize: fitFontSize(name) }}>
        {name}
      </a>
    </div>
    {children}
  </footer>
);

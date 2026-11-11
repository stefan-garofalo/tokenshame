import type { ReactNode } from "react";

import { fitFontSize } from "../fit-width";
import { repoUrl } from "../links";

const name = "tokenshame";

/** The close: the name again at full width, and one honest sentence about what the link holds. */
export const SiteFooter = ({ children }: { children?: ReactNode }) => (
  <footer className="footer">
    <p className="footer-note">
      The link carries the numbers and nothing else. No prompts, no account.
    </p>
    <a className="footer-mark" href={repoUrl} style={{ fontSize: fitFontSize(name) }}>
      {name}
    </a>
    {children}
  </footer>
);

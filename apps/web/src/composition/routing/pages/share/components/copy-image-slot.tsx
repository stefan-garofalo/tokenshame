import type { ReactNode } from "react";

/** Where the Copy image button mounts. It has no behavior of its own. */
export const CopyImageSlot = ({ children }: { children?: ReactNode }) => (
  <div data-slot="copy-image">{children}</div>
);

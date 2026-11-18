import type { ReactNode } from "react";

/** Where the Post on X button mounts. It has no behavior of its own. */
export const PostOnXSlot = ({ children }: { children?: ReactNode }) => (
  <div data-slot="post-on-x">{children}</div>
);

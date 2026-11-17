/** The title bar of a pane, like the status line of a terminal multiplexer. It decorates; headings carry the meaning. */
export const Bar = ({ tag, title }: { tag?: string; title: string }) => (
  <div aria-hidden="true" className="bar">
    <span>{title}</span>
    {tag && <span className="bar-tag">{tag}</span>}
  </div>
);

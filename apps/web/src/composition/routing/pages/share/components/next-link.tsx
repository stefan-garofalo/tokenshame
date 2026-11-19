/** The way to the next slide of the Wrapped: a plain anchor, so it works without script. */
export const NextLink = ({ href, label = "Next" }: { href: string; label?: string }) => (
  <a className="next" href={href}>
    <span>{label}</span>
    <svg aria-hidden="true" className="next-arrow" viewBox="0 0 48 48">
      <path d="M24 8v32M12 28l12 12 12-12" />
    </svg>
  </a>
);

const composerUrl = "https://x.com/intent/post";

// `share.css` colours every link on the page with `inherit`, and it is not in a layer, so the colours need `!`.
const classes = [
  "inline-flex min-h-12 min-w-28 cursor-pointer items-center justify-center px-6 text-center leading-none font-black whitespace-normal no-underline!",
  "bg-(--ts-mustard) text-(--ts-mustard-ink)!",
  "transition-[transform,background-color] duration-(--ts-t-hover) active:scale-[0.97] active:duration-(--ts-t-press)",
  "hover:bg-(--ts-bg) focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-(--ts-red-ink)",
].join(" ");

/** A plain link to X's post composer, filled with the Share Page URL. It works without script. */
export const PostOnXButton = ({ pageUrl, text }: { pageUrl: string; text: string }) => (
  <a
    className={classes}
    href={`${composerUrl}?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`}
    rel="noopener noreferrer"
    target="_blank"
  >
    Post on X
  </a>
);

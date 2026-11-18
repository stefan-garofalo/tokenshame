const composerUrl = "https://x.com/intent/post";

/** A plain link to X's post composer, filled with the Share Page URL. It works without script. */
export const PostOnXButton = ({ pageUrl, text }: { pageUrl: string; text: string }) => (
  <a
    className="btn btn-accent"
    href={`${composerUrl}?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(text)}`}
    rel="noopener noreferrer"
    target="_blank"
  >
    Post on X
  </a>
);

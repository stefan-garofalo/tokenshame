import type { ReactNode } from "react";

/** One kind of token in a code line, coloured like an editor theme. */
type Kind = "key" | "prop" | "num" | "str" | "com" | "err";

export const Tok = ({ kind, children }: { kind: Kind; children: ReactNode }) => (
  <span className={`tok-${kind}`}>{children}</span>
);

/**
 * A cropped piece of a code editor: a tab bar, a gutter and the lines. It is the product's own
 * interface (`data-ui`), so its 1px borders and line numbers follow the editor, not the page.
 */
export const Editor = ({
  file,
  lines,
  label,
}: {
  file: string;
  lines: readonly ReactNode[];
  /** What the code says, for screen readers; the code itself is hidden from them. */
  label: string;
}) => (
  <figure className="editor" data-ui>
    <figcaption className="sr-only">{label}</figcaption>
    <div aria-hidden="true" className="editor-tabs">
      <span className="editor-tab">{file}</span>
    </div>
    <pre aria-hidden="true" className="editor-code">
      {lines.map((line, index) => (
        // The lines are fixed for a render, so the position is a stable key.
        // oxlint-disable-next-line react/no-array-index-key
        <span className="editor-line" key={index}>
          <span className="editor-gutter">{index + 1}</span>
          <code>{line}</code>
        </span>
      ))}
    </pre>
  </figure>
);

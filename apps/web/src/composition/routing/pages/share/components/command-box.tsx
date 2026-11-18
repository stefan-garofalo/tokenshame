import { useState } from "react";

import { command } from "../links";

const copiedForMs = 1600;

/** The command as a block in the running text, then a Copy button. A tap on the text selects it all. */
export const CommandBox = () => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // The browser refused the clipboard. The text stays selectable, so the visitor can still copy it.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), copiedForMs);
  };

  return (
    <span className="command">
      <code className="command-text" data-command>
        {command}
      </code>
      <button className="btn btn-accent command-copy" onClick={copy} type="button">
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </span>
  );
};

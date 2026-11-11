import { useState } from "react";

import { fitFontSize } from "../fit-width";
import { command } from "../links";

const copiedForMs = 1600;

/** The command to run, in a box. One press copies it; a tap or click on the text selects it all. */
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
    <div className="command">
      <code className="command-text" data-command style={{ fontSize: fitFontSize(command) }}>
        {command}
      </code>
      <button className="command-copy" onClick={copy} type="button">
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
};

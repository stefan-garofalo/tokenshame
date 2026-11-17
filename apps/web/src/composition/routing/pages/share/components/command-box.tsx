import { useState } from "react";

import { fitFontSize } from "../fit-width";
import { command } from "../links";

const copiedForMs = 1600;
const prompt = "$ ";

/** The command to run, as a shell line. One press copies it; a tap or click on the text selects it all. */
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
      <p className="command-line" style={{ fontSize: fitFontSize(`${prompt}${command}`) }}>
        <span aria-hidden="true" className="command-prompt">
          {prompt}
        </span>
        <code className="command-text" data-command>
          {command}
        </code>
      </p>
      <button className="btn btn-accent command-copy" onClick={copy} type="button">
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
};

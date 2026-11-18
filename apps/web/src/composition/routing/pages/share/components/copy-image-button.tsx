import { useState, useSyncExternalStore } from "react";

const copiedForMs = 1600;

type Status = "idle" | "copied" | "failed";

const classes = "btn btn-quiet";

// What the browser can do never changes, so there is nothing to subscribe to.
const subscribeToNothing = () => () => {
  // Nothing to unsubscribe from.
};
const browserCanCopyImages = () => "ClipboardItem" in window && "clipboard" in navigator;
const serverCannotCopy = () => false;

const labels = {
  copied: "Copied",
  failed: "Copy failed. Open image",
  idle: "Copy image",
} satisfies Record<Status, string>;

const announcements = {
  copied: "Image copied. Paste it into your post.",
  failed: "Could not copy the image. Open it and save it instead.",
  idle: "",
} satisfies Record<Status, string>;

const fetchPng = async (imageUrl: string) => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Share Card request failed with ${response.status}`);
  }
  return response.blob();
};

// The clipboard gets the promise, so Safari still sees the write inside the tap.
const copyImage = (imageUrl: string) =>
  navigator.clipboard.write([new ClipboardItem({ "image/png": fetchPng(imageUrl) })]);

/**
 * Puts the Share Card on the clipboard. Without script, or in a browser that cannot copy images,
 * it is a link that opens the image so the visitor can save it. After a failed copy it becomes that link too.
 */
export const CopyImageButton = ({ imageUrl }: { imageUrl: string }) => {
  const canCopy = useSyncExternalStore(subscribeToNothing, browserCanCopyImages, serverCannotCopy);
  const [status, setStatus] = useState<Status>("idle");

  const copy = async () => {
    try {
      await copyImage(imageUrl);
    } catch {
      setStatus("failed");
      return;
    }
    setStatus("copied");
    setTimeout(() => setStatus("idle"), copiedForMs);
  };

  return (
    <>
      {canCopy && status !== "failed" ? (
        <button className={classes} onClick={copy} type="button">
          {labels[status]}
        </button>
      ) : (
        <a className={classes} href={imageUrl} rel="noopener noreferrer" target="_blank">
          {status === "failed" ? labels.failed : "Open image"}
        </a>
      )}
      <output className="sr-only">{announcements[status]}</output>
    </>
  );
};

import type { CSSProperties } from "react";

import { fitFontSize } from "../share/fit-width";
import { command } from "../share/links";
import type { CardContent, CardLine } from "./card-content";
import { card, colors, display, family, textWeight, tracking } from "./card-tokens";

// The card is a board of panes, as the Share Page is: a lime pane with the figure on the left, three
// panes of output on the right. The card has no container, so the viewport is the card: `1cqw` is 1% of
// its width, and a lockup line spans the width inside the lime pane.
const leftWidth = 680;
const rightWidth = card.width - 2 * card.margin - card.gap - leftWidth;
const spanPercent = ((leftWidth - 2 * card.pad) / card.width) * 100;
// A short number would grow past the pane; the cap keeps it inside.
const maxLockupSize = "150px";

const pane = (background: string, color: string): CSSProperties => ({
  background,
  color,
  display: "flex",
  flexDirection: "column",
  fontFamily: family,
  padding: card.pad,
});

const Lockup = ({ lines }: { lines: readonly string[] }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    {lines.map((line) => (
      <div
        key={line}
        style={{
          fontSize: `min(${fitFontSize(line, spanPercent)}, ${maxLockupSize})`,
          fontWeight: display.weight,
          letterSpacing: tracking,
          lineHeight: display.leading,
          whiteSpace: "nowrap",
        }}
      >
        {line}
      </div>
    ))}
  </div>
);

const Prompt = () => (
  <div style={{ display: "flex", fontSize: 24, fontWeight: textWeight }}>{`$ ${command}`}</div>
);

// The number inside the sentence is the figure of the line: lime, like the figures of the Share Page.
const Output = ({ line: { quantity, text }, tone }: { line: CardLine; tone: string }) => {
  const at = text.indexOf(quantity);
  return (
    <div
      style={{
        ...pane(tone, colors.ink),
        flex: 1,
        fontSize: 20,
        fontWeight: textWeight,
        justifyContent: "center",
        lineHeight: 1.4,
        paddingBottom: 14,
        paddingTop: 14,
      }}
    >
      <span>
        {text.slice(0, at)}
        <span style={{ color: colors.accent, fontWeight: display.weight }}>{quantity}</span>
        {text.slice(at + quantity.length)}
      </span>
    </div>
  );
};

const SharedCard = ({
  content,
  domain,
}: {
  content: Extract<CardContent, { _tag: "Shared" }>;
  domain: string;
}) => (
  <>
    <div
      style={{
        ...pane(colors.accent, colors.accentInk),
        justifyContent: "space-between",
        overflow: "hidden",
        width: leftWidth,
      }}
    >
      <Prompt />
      <Lockup lines={[content.figure, content.label]} />
      <div style={{ display: "flex", fontSize: 24, fontWeight: display.weight }}>{domain}</div>
    </div>
    <div
      style={{
        display: "flex",
        flex: 1,
        flexDirection: "column",
        gap: card.gap,
        width: rightWidth,
      }}
    >
      {content.lines.map((line, index) => (
        <Output key={line.text} line={line} tone={index === 1 ? colors.black : colors.surface} />
      ))}
    </div>
  </>
);

// What the broken-link page says, set the same way.
const BrokenCard = ({ domain }: { domain: string }) => (
  <div
    style={{
      ...pane(colors.accent, colors.accentInk),
      flex: 1,
      justifyContent: "space-between",
      overflow: "hidden",
    }}
  >
    <Prompt />
    <div style={{ display: "flex", flexDirection: "column", rowGap: 24 }}>
      <Lockup lines={["this roast is broken.", `Run ${command}`]} />
      <div style={{ display: "flex", fontSize: 28, fontWeight: textWeight, lineHeight: 1.3 }}>
        The link is damaged or cut short. One command makes a new one.
      </div>
    </div>
    <div style={{ display: "flex", fontSize: 24, fontWeight: display.weight }}>{domain}</div>
  </div>
);

/**
 * The Share Card: the lockup on a lime pane, the three Roast Lines as panes of output, the domain and
 * the command in the lime pane. A link that does not decode gets the same colors and type with the
 * message of the broken-link page.
 */
export const CardLayout = ({ content, domain }: { content: CardContent; domain: string }) => (
  <div
    style={{
      background: colors.bg,
      display: "flex",
      flexDirection: "row",
      gap: card.gap,
      height: card.height,
      padding: card.margin,
      width: card.width,
    }}
  >
    {content._tag === "Shared" ? (
      <SharedCard content={content} domain={domain} />
    ) : (
      <BrokenCard domain={domain} />
    )}
  </div>
);

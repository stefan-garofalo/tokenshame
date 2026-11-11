import type { CSSProperties, ReactNode } from "react";

import { fitFontSize } from "../share/fit-width";
import { command } from "../share/links";
import type { CardContent, CardLine } from "./card-content";
import { card, colors, display, family, textWeight, tracking } from "./card-tokens";

// The card has no container, so the viewport is the card: `1cqw` is 1% of its width. A lockup line
// spans the width between the margins, as on the Share Page.
const spanPercent = ((card.width - 2 * card.margin) / card.width) * 100;
const heroHeight = 316;
const footerHeight = 52;
// A short number would grow past the hero; the cap keeps it inside.
const maxLockupSize = "170px";

const field = (background: string, color: string): CSSProperties => ({
  background,
  color,
  display: "flex",
  flexDirection: "column",
  fontFamily: family,
  paddingLeft: card.margin,
  paddingRight: card.margin,
});

const Lockup = ({ lines }: { lines: readonly string[] }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    {lines.map((line) => (
      <div
        key={line}
        style={{
          fontSize: `min(${fitFontSize(line, spanPercent)}, ${maxLockupSize})`,
          fontVariantNumeric: "tabular-nums",
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

// The number inside the sentence is the figure of the line: mustard, like the figures of the Share Page.
const Warning = ({ line: { quantity, text } }: { line: CardLine }) => {
  const at = text.indexOf(quantity);
  return (
    <div
      style={{
        borderTop: `4px solid ${colors.mustard}`,
        display: "flex",
        fontSize: 25,
        fontWeight: textWeight,
        lineHeight: 1.2,
        paddingTop: 8,
      }}
    >
      <span>
        {text.slice(0, at)}
        <span style={{ color: colors.mustard, fontWeight: display.weight }}>{quantity}</span>
        {text.slice(at + quantity.length)}
      </span>
    </div>
  );
};

const Footer = ({ children, domain }: { children?: ReactNode; domain: string }) => (
  <div
    style={{
      ...field(colors.red, colors.redInk),
      alignItems: "center",
      flexDirection: "row",
      fontSize: 26,
      fontWeight: display.weight,
      height: footerHeight,
      justifyContent: "space-between",
      letterSpacing: tracking,
    }}
  >
    <span>{domain}</span>
    {children}
  </div>
);

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
        ...field(colors.red, colors.redInk),
        height: heroHeight,
        justifyContent: "flex-end",
        overflow: "hidden",
        paddingBottom: 14,
      }}
    >
      <Lockup lines={[content.figure, content.label]} />
    </div>
    <div
      style={{
        ...field(colors.ink, colors.bone),
        flex: 1,
        justifyContent: "space-between",
        paddingBottom: 12,
        paddingTop: 12,
      }}
    >
      {content.lines.map((line) => (
        <Warning key={line.text} line={line} />
      ))}
    </div>
    <Footer domain={domain}>
      <span>{command}</span>
    </Footer>
  </>
);

// What the broken-link page says, set the same way.
const BrokenCard = ({ domain }: { domain: string }) => (
  <>
    <div
      style={{
        ...field(colors.red, colors.redInk),
        flex: 1,
        justifyContent: "flex-end",
        paddingBottom: 14,
        rowGap: 28,
      }}
    >
      <Lockup lines={["this roast is broken.", `Run ${command}`]} />
      <div style={{ fontSize: 30, fontWeight: textWeight, lineHeight: 1.25 }}>
        The link is damaged or cut short. One command makes a new one.
      </div>
    </div>
    <Footer domain={domain} />
  </>
);

/**
 * The Share Card: the lockup on red, the three Roast Lines on ink, the domain and the command on red.
 * A link that does not decode gets the same colors and type with the message of the broken-link page.
 */
export const CardLayout = ({ content, domain }: { content: CardContent; domain: string }) => (
  <div style={{ display: "flex", flexDirection: "column", height: card.height, width: card.width }}>
    {content._tag === "Shared" ? (
      <SharedCard content={content} domain={domain} />
    ) : (
      <BrokenCard domain={domain} />
    )}
  </div>
);

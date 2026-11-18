import type { CSSProperties } from "react";

import { fitFontSize } from "../share/fit-width";
import { command } from "../share/links";
import type { CardContent, CardLine } from "./card-content";
import { card, colors, display, family, textWeight, tracking } from "./card-tokens";

// The card is the Share Page's editor theme on black: a pane with the month's figure on the left,
// three panes of output on the right, each under a tab bar. The card has no container, so the viewport
// is the card: `1cqw` is 1% of its width, and a lockup line spans the width inside the left pane.
const leftWidth = 680;
const rightWidth = card.width - 2 * card.margin - card.gap - leftWidth;
const spanPercent = ((leftWidth - 2 * card.pad) / card.width) * 100;
// A short number would grow past the pane; the cap keeps it inside.
const maxLockupSize = "150px";

const pane = (background: string): CSSProperties => ({
  background,
  color: colors.ink,
  display: "flex",
  flexDirection: "column",
  fontFamily: family,
  overflow: "hidden",
});

const body: CSSProperties = {
  display: "flex",
  flex: 1,
  flexDirection: "column",
  padding: card.pad,
};

const Bar = ({ tag, title }: { tag?: string; title: string }) => (
  <div
    style={{
      background: colors.bar,
      color: colors.muted,
      display: "flex",
      flex: "none",
      fontSize: 16,
      fontWeight: textWeight,
      justifyContent: "space-between",
      padding: `8px ${card.pad}px`,
    }}
  >
    <span>{title}</span>
    {tag && <span style={{ color: colors.accent }}>{tag}</span>}
  </div>
);

const Lockup = ({ lines }: { lines: readonly string[] }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    {lines.map((line, index) => (
      <div
        key={line}
        style={{
          color: index === 0 ? colors.accent : colors.ink,
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
  <div style={{ columnGap: 14, display: "flex", fontSize: 24, fontWeight: textWeight }}>
    <span style={{ color: colors.accent }}>$</span>
    <span>{command}</span>
  </div>
);

const Domain = ({ domain }: { domain: string }) => (
  <div style={{ color: colors.accent, display: "flex", fontSize: 24, fontWeight: display.weight }}>
    {domain}
  </div>
);

// The number inside the sentence is the figure of the line: lime, like the figures of the Share Page.
const Output = ({
  index,
  line: { quantity, text },
  total,
}: {
  index: number;
  line: CardLine;
  total: number;
}) => {
  const at = text.indexOf(quantity);
  return (
    <div style={{ ...pane(index === 1 ? colors.raised : colors.surface), flex: 1 }}>
      <Bar title={`out ${String(index + 1)}/${String(total)}`} />
      <div
        style={{
          ...body,
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
    <div style={{ ...pane(colors.surface), width: leftWidth }}>
      <Bar tag="last 30 days" title="month.ts" />
      <div style={{ ...body, justifyContent: "space-between" }}>
        <Prompt />
        <Lockup lines={[content.figure, content.label]} />
        <Domain domain={domain} />
      </div>
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
        <Output index={index} key={line.text} line={line} total={content.lines.length} />
      ))}
    </div>
  </>
);

// What the broken-link page says, set the same way.
const BrokenCard = ({ domain }: { domain: string }) => (
  <div style={{ ...pane(colors.surface), flex: 1 }}>
    <Bar tag="exit 1" title="link.ts" />
    <div style={{ ...body, justifyContent: "space-between" }}>
      <Prompt />
      <div style={{ display: "flex", flexDirection: "column", rowGap: 24 }}>
        <Lockup lines={["this roast is broken.", `Run ${command}`]} />
        <div style={{ display: "flex", fontSize: 28, fontWeight: textWeight, lineHeight: 1.3 }}>
          Even the roast gave up. Make a new one.
        </div>
      </div>
      <Domain domain={domain} />
    </div>
  </div>
);

/**
 * The Share Card: the lockup in a dark pane, the three Roast Lines as panes of output, the domain and
 * the command in the first pane. A link that does not decode gets the same colors and type with the
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

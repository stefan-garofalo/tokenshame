import type { CSSProperties } from "react";

import { fitFontSize } from "../share/fit-width";
import { command } from "../share/links";
import type { CardContent, CardKpi } from "./card-content";
import {
  card,
  colors,
  display,
  family,
  fieldInk,
  fields,
  textWeight,
  tracking,
} from "./card-tokens";

// The card is the bento of the Share Page's last slide: the full token count and the KPIs as tiles,
// each on its slide's colour. The card has no container, so the viewport is the card: `1cqw` is 1% of
// its width, and a line set with `fitFontSize` spans a share of the card's width.
const leftWidth = 680;
const spanPercent = ((leftWidth - 2 * card.pad) / card.width) * 100;

// Four columns of KPI tiles; the token count takes three of them, the first KPI the fourth.
const columns = 4;
const tileWidth = (card.width - 2 * card.margin - (columns - 1) * card.gap) / columns;
const countSpan = ((3 * tileWidth + 2 * card.gap - 2 * card.pad) / card.width) * 100;
const tilePad = 20;
const figureSpan = ((tileWidth - 2 * tilePad) / card.width) * 100;
const rows = { foot: 50, top: 290 } as const;
const maxCountSize = "200px";
// The first KPI has a taller tile, so its figure may be larger.
const maxFigureSize = { first: "120px", other: "88px" } as const;
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

const Tile = ({ kpi, maxSize }: { kpi: CardKpi; maxSize: string }) => (
  <div
    style={{
      background: fields[kpi.id],
      color: fieldInk,
      display: "flex",
      flex: 1,
      flexDirection: "column",
      fontFamily: family,
      fontSize: 20,
      fontWeight: textWeight,
      lineHeight: 1.25,
      padding: tilePad,
      rowGap: 6,
    }}
  >
    <div
      style={{
        fontSize: `min(${fitFontSize(kpi.figure, figureSpan)}, ${maxSize})`,
        fontWeight: display.weight,
        letterSpacing: tracking,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {kpi.figure}
    </div>
    <div>{`${kpi.unit} ${kpi.tile.label}`}</div>
    <div style={{ fontWeight: display.weight, marginTop: "auto" }}>{kpi.tile.quip}</div>
  </div>
);

const Count = ({ content }: { content: Extract<CardContent, { _tag: "Shared" }> }) => (
  <div
    style={{
      ...pane(colors.surface),
      flex: 1,
      justifyContent: "space-between",
      padding: card.pad,
    }}
  >
    <div style={{ color: colors.muted, display: "flex", fontSize: 22, fontWeight: textWeight }}>
      {content.kpis.length > 0
        ? "your last 30 days with AI, wrapped"
        : "nothing to roast. suspiciously clean."}
    </div>
    <div style={{ display: "flex", flexDirection: "column", rowGap: 10 }}>
      <div
        style={{
          color: colors.accent,
          fontSize: `min(${fitFontSize(content.figure, countSpan)}, ${maxCountSize})`,
          fontWeight: display.weight,
          letterSpacing: tracking,
          lineHeight: display.leading,
          whiteSpace: "nowrap",
        }}
      >
        {content.figure}
      </div>
      <div style={{ display: "flex", fontSize: 30, fontWeight: display.weight }}>
        {`${content.label} in 30 days`}
      </div>
    </div>
  </div>
);

const Foot = ({ domain }: { domain: string }) => (
  <div
    style={{
      alignItems: "center",
      background: colors.accent,
      color: colors.accentInk,
      display: "flex",
      flex: "none",
      fontFamily: family,
      fontSize: 22,
      fontWeight: display.weight,
      height: rows.foot,
      justifyContent: "space-between",
      padding: `0 ${tilePad}px`,
    }}
  >
    <span>cry about it.</span>
    <span>{`${command} · ${domain}`}</span>
  </div>
);

const row = (height?: number): CSSProperties => ({
  columnGap: card.gap,
  display: "flex",
  flex: height === undefined ? 1 : "none",
  height,
});

const SharedCard = ({
  content,
  domain,
}: {
  content: Extract<CardContent, { _tag: "Shared" }>;
  domain: string;
}) => {
  const [first, ...others] = content.kpis;
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", rowGap: card.gap }}>
      <div style={row(first ? rows.top : undefined)}>
        <Count content={content} />
        {first && (
          <div style={{ display: "flex", width: tileWidth }}>
            <Tile kpi={first} maxSize={maxFigureSize.first} />
          </div>
        )}
      </div>
      {others.length > 0 && (
        <div style={row()}>
          {others.map((kpi) => (
            <Tile key={kpi.id} kpi={kpi} maxSize={maxFigureSize.other} />
          ))}
        </div>
      )}
      <Foot domain={domain} />
    </div>
  );
};

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
 * The Share Card: the bento of the Share Page, with the full token count, the KPI tiles, and a foot
 * with the command and the domain. A link that does not decode gets the same colors and type with
 * the message of the broken-link page.
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

import { tokensProcessed } from "@tokenshame/share-link/summary";
import type { Summary, Tokens } from "@tokenshame/share-link/summary";

import type { SkippedSource } from "./agents/types";

const count = (value: number): string => value.toLocaleString("en-US");

// Wide enough for the longest label, "Tokens processed", plus two spaces.
const factLabelWidth = 18;

const columns = ["Input", "Output", "Cache read", "Cache write"] as const;

const cells = ({ input, output, cacheRead, cacheWrite }: Tokens): readonly string[] =>
  [input, output, cacheRead, cacheWrite].map(count);

/** Rows of left-aligned first column and right-aligned number columns, as lines. */
const table = (rows: readonly (readonly string[])[]): readonly string[] => {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
      )
      .join("  "),
  );
};

/**
 * The exact Usage Summary the Share Link carries, and the link. Every field of the
 * summary is here and nothing else: counts only, never prompt text, project names,
 * or paths.
 */
export const renderSummary = (summary: Summary, url: string): string => {
  const facts = [
    ["Tokens processed", count(tokensProcessed(summary))],
    ["Sessions", count(summary.sessions)],
    ["Busiest hour", `${String(summary.busiestHour).padStart(2, "0")}:00`],
    ["First day", summary.firstDay],
    ["Version", String(summary.version)],
  ].map(([label, value]) => `${label?.padEnd(factLabelWidth)}${value}`);
  const models = table([
    ["Model", ...columns],
    ...summary.models.map((usage) => [usage.model, ...cells(usage)]),
    ["other", ...cells(summary.other)],
  ]);
  return [
    "Usage Summary (exactly what the Share Link carries)",
    "",
    ...facts,
    "",
    ...models,
    "",
    `Share Link: ${url}`,
  ].join("\n");
};

/** Names a source that exists but could not be read, with its cause. */
export const renderSkipped = ({ agent, detail, path }: SkippedSource): string =>
  `Skipped ${agent}: ${detail} (${path})`;

/** The no-logs message: the folders that were checked, and no Share Link. */
export const renderNoLogs = (paths: readonly string[]): string =>
  ["No usage logs found. Checked:", ...paths.map((path) => `  ${path}`)].join("\n");

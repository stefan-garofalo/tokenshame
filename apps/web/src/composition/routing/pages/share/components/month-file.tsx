import { Fragment } from "react";

import type { Roast } from "../../../../../server/roast";
import { Editor, Tok } from "./editor";

/** A number as a JavaScript literal: `1_094_660_000`. */
const literal = (value: number): string =>
  String(Math.round(value)).replaceAll(/\B(?=(?:\d{3})+(?!\d))/gu, "_");

// Code comments, kept as strings: in JSX a bare `//` would read as a comment.
const headerComment = "// your last 30 days of usage";
const costComment = "// API list prices";

/** An hour of the day as `14:00`. */
export const clock = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** The month as the source file it reads like: the Usage Summary's numbers as literals. */
export const MonthFile = ({
  cost,
  headline,
  month,
}: Pick<Roast, "cost" | "headline" | "month">) => (
  <Editor
    file="month.ts"
    label={`month.ts: ${headline.figure} tokens, ${String(month.sessions)} sessions, busiest hour ${clock(month.busiestHour)}, ${cost.figure} at API list prices.`}
    lines={[
      <Tok key="c" kind="com">
        {headerComment}
      </Tok>,
      <Fragment key="open">
        <Tok kind="key">export const</Tok> <Tok kind="prop">month</Tok> = {"{"}
      </Fragment>,
      <Fragment key="tokens">
        {"  "}
        <Tok kind="prop">tokens</Tok>: <Tok kind="num">{literal(headline.tokens)}</Tok>,
      </Fragment>,
      <Fragment key="sessions">
        {"  "}
        <Tok kind="prop">sessions</Tok>: <Tok kind="num">{literal(month.sessions)}</Tok>,
      </Fragment>,
      <Fragment key="hour">
        {"  "}
        <Tok kind="prop">busiestHour</Tok>: <Tok kind="str">{`"${clock(month.busiestHour)}"`}</Tok>,
      </Fragment>,
      <Fragment key="cost">
        {"  "}
        <Tok kind="prop">costUsd</Tok>: <Tok kind="num">{literal(cost.usd)}</Tok>,{" "}
        <Tok kind="com">{costComment}</Tok>
      </Fragment>,
      <Fragment key="close">
        {"}"} <Tok kind="key">as const</Tok>;
      </Fragment>,
    ]}
  />
);

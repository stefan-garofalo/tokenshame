import { useId, useState } from "react";

import { factors } from "../../../../../server/roast";
import type { Roast } from "../../../../../server/roast";

const minRate = 10;
const maxRate = 300;

/** Hours to one decimal below ten, whole hours with separators above. */
const formatHours = (hours: number): string =>
  hours < 10
    ? hours.toFixed(1)
    : Math.round(hours).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * The cost as hours of the visitor's own pay. The slider starts at the median hourly pay of US
 * software developers. Without script the figure stays at that rate.
 */
export const Hours = ({ cost }: { cost: Roast["cost"] }) => {
  const [rate, setRate] = useState(Math.round(factors.devHourlyWage.value));
  const inputId = useId();
  const hours = formatHours(cost.usd / rate);

  return (
    <section aria-labelledby="hours-title" className="hours">
      <h2 className="hours-title" id="hours-title">
        What is an hour of you worth?
      </h2>
      <div className="rate" data-ui>
        <label className="rate-row" htmlFor={inputId}>
          <span>Your hourly rate</span>
          <output htmlFor={inputId}>${rate}/h</output>
        </label>
        <input
          className="rate-input"
          id={inputId}
          max={maxRate}
          min={minRate}
          onChange={(event) => setRate(Number(event.currentTarget.value))}
          step={1}
          type="range"
          value={rate}
        />
      </div>
      <p className="hours-figure">
        <span className="hours-number">{hours}</span>{" "}
        <span className="hours-unit">{hours === "1.0" ? "hour" : "hours"} of your salary</span>
      </p>
      <p className="hours-note">
        At API prices this month cost {cost.figure}. The slider starts at the median US developer,
        so adjust your ego accordingly.
      </p>
    </section>
  );
};

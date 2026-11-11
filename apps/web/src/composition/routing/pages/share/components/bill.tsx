import type { Roast } from "../../../../../server/roast";
import { fitFontSize } from "../fit-width";
import { HowWeCalculated } from "./how-we-calculated";

/** The estimated cost: the one key number besides Tokens Processed. */
export const Bill = ({ cost }: { cost: Roast["cost"] }) => (
  <section className="bill" aria-labelledby="bill-title">
    <h2 className="section-title" id="bill-title">
      The bill
    </h2>
    <div className="bill-body">
      <p className="bill-figure" style={{ fontSize: fitFontSize(cost.figure, "var(--span)") }}>
        {cost.figure}
      </p>
      <div className="bill-caption">
        <p>Estimated cost of these tokens at API list prices.</p>
        <HowWeCalculated />
      </div>
    </div>
  </section>
);

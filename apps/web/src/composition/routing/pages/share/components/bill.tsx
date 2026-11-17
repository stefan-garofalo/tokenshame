import type { Roast } from "../../../../../server/roast";
import { fitFontSize } from "../fit-width";
import { HowWeCalculated } from "./how-we-calculated";

/** The estimated cost: the one key number besides Tokens Processed. */
export const Bill = ({ cost }: { cost: Roast["cost"] }) => (
  <section aria-labelledby="bill-title" className="pane pane-paper pane-cost">
    <h2 className="pane-title" id="bill-title">
      The bill
    </h2>
    <p className="bill-figure" style={{ fontSize: fitFontSize(cost.figure, 45) }}>
      {cost.figure}
    </p>
    <p className="bill-note">Estimated cost of these tokens at API list prices.</p>
    <HowWeCalculated />
  </section>
);

import type { ImpactId } from "../../../../server/roast";
import coal from "./pictures/coal.jpg";
import flights from "./pictures/flights.jpg";
import trees from "./pictures/trees.jpg";
import villages from "./pictures/villages.jpg";

/**
 * A real picture of the world a Roast Line talks about, found in an open collection. It
 * shows that world and is never the user's own.
 */
export interface Picture {
  src: string;
  alt: string;
  title: string;
  author: string;
  licence: string;
  licenceUrl: string;
  page: string;
}

const bySa4 = {
  licence: "CC BY-SA 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0",
};

/** The picture of each line that has an honest one. Other lines show none. */
export const pictures = new Map<ImpactId, Picture>([
  [
    "villages",
    {
      ...bySa4,
      alt: "A hand pump for water under a tree at the edge of a village field",
      author: "Bhaveshkumar855",
      page: "https://commons.wikimedia.org/wiki/File:Water_pump_in_Uttar_Pardesh,_India,_2014.jpg",
      src: villages,
      title: "Water pump in Uttar Pardesh, India, 2014",
    },
  ],
  [
    "coal",
    {
      ...bySa4,
      alt: "Striped chimneys of a coal power station rising over trees",
      author: "Jayadevp13",
      page: "https://commons.wikimedia.org/wiki/File:VSTPS.jpg",
      src: coal,
      title: "VSTPS",
    },
  ],
  [
    "flights",
    {
      alt: "An aircraft wing above a layer of clouds, in black and white",
      author: "formulanone",
      licence: "CC BY-SA 2.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0",
      page: "https://commons.wikimedia.org/wiki/File:WingOverLittlePuffyClouds-Mar2013_(35035579590).jpg",
      src: flights,
      title: "WingOverLittlePuffyClouds-Mar2013",
    },
  ],
  [
    "trees",
    {
      alt: "Branches of an old oak tree against a blue sky",
      author: "Юрий Д.К.",
      licence: "CC BY 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by/4.0",
      page: "https://commons.wikimedia.org/wiki/File:Moscow._A_500-year-old_oak_tree_in_Kolomenskoe2.jpg",
      src: trees,
      title: "Moscow. A 500-year-old oak tree in Kolomenskoe2",
    },
  ],
]);

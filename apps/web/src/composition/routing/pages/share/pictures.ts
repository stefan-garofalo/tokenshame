import type { ImpactId } from "../../../../server/roast";
import coal from "./pictures/coal.jpg";
import glacier from "./pictures/glacier.jpg";
import ice from "./pictures/ice.jpg";
import land from "./pictures/land.jpg";
import ocean from "./pictures/ocean.jpg";
import flights from "./pictures/flights.jpg";
import trees from "./pictures/trees.jpg";
import water from "./pictures/water.jpg";

/**
 * A real picture of the world a Roast Line talks about, found in an open collection. It
 * shows that world and is never the user's own.
 */
export interface Picture {
  src: string;
  width: number;
  height: number;
  alt: string;
  title: string;
  author: string;
  licence: string;
  licenceUrl: string;
  page: string;
}

const licences = {
  by2: { licence: "CC BY 2.0", licenceUrl: "https://creativecommons.org/licenses/by/2.0" },
  by25: { licence: "CC BY 2.5", licenceUrl: "https://creativecommons.org/licenses/by/2.5" },
  by4: { licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0" },
  bySa2: { licence: "CC BY-SA 2.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0" },
  bySa4: { licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  pd: { licence: "public domain", licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0" },
} as const;

/** The picture of each Roast Line that has one. */
export const pictures = new Map<ImpactId, Picture>([
  [
    "water",
    {
      ...licences.bySa4,
      alt: "A hand pump for water under a tree at the edge of a village field",
      author: "Bhaveshkumar855",
      height: 720,
      page: "https://commons.wikimedia.org/wiki/File:Water_pump_in_Uttar_Pardesh,_India,_2014.jpg",
      src: water,
      title: "Water pump in Uttar Pardesh, India, 2014",
      width: 960,
    },
  ],
  [
    "ice",
    {
      ...licences.by25,
      alt: "A polar bear climbing over broken sea ice",
      author: "Hannes Grobe, Alfred Wegener Institute for Polar and Marine Research",
      height: 726,
      page: "https://commons.wikimedia.org/w/index.php?curid=1364598",
      src: ice,
      title: "Polar bear hg",
      width: 960,
    },
  ],
  [
    "glacier",
    {
      ...licences.bySa2,
      alt: "A thin tongue of glacier ice left at the bottom of a bare rock valley",
      author: "Rod Waddington",
      height: 640,
      page: "https://commons.wikimedia.org/w/index.php?curid=145129141",
      src: glacier,
      title: "Fox Glacier Retreat, NZ",
      width: 960,
    },
  ],
  [
    "ocean",
    {
      ...licences.bySa2,
      alt: "A reef flat of bleached white coral at low tide",
      author: "Oregon State University",
      height: 727,
      page: "https://commons.wikimedia.org/w/index.php?curid=50490719",
      src: ocean,
      title: "Bleached coral",
      width: 960,
    },
  ],
  [
    "land",
    {
      ...licences.by2,
      alt: "A data center campus among bare fields and trees, seen from the air at sunset",
      author: "chaddavis.photography",
      height: 540,
      page: "https://commons.wikimedia.org/w/index.php?curid=84181144",
      src: land,
      title: "Google Data Center, Council Bluffs Iowa",
      width: 960,
    },
  ],
  [
    "coal",
    {
      ...licences.bySa4,
      alt: "Striped chimneys of a coal power station rising over trees",
      author: "Jayadevp13",
      height: 581,
      page: "https://commons.wikimedia.org/wiki/File:VSTPS.jpg",
      src: coal,
      title: "VSTPS",
      width: 960,
    },
  ],
  [
    "trees",
    {
      ...licences.by4,
      alt: "Branches of an old oak tree against a blue sky",
      author: "Юрий Д.К.",
      height: 533,
      page: "https://commons.wikimedia.org/wiki/File:Moscow._A_500-year-old_oak_tree_in_Kolomenskoe2.jpg",
      src: trees,
      title: "Moscow. A 500-year-old oak tree in Kolomenskoe2",
      width: 800,
    },
  ],
  [
    "flights",
    {
      ...licences.bySa2,
      alt: "An aircraft wing above a layer of clouds",
      author: "formulanone",
      height: 639,
      page: "https://commons.wikimedia.org/wiki/File:WingOverLittlePuffyClouds-Mar2013_(35035579590).jpg",
      src: flights,
      title: "WingOverLittlePuffyClouds-Mar2013",
      width: 960,
    },
  ],
]);

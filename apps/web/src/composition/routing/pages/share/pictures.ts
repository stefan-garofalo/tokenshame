import type { ImpactId } from "../../../../server/roast";
import baths from "./pictures/baths.jpg";
import flights from "./pictures/flights.jpg";
import floppies from "./pictures/floppies.jpg";
import laptops from "./pictures/laptops.jpg";
import reading from "./pictures/reading.jpg";
import wikipedia from "./pictures/wikipedia.jpg";

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
  bySa2: { licence: "CC BY-SA 2.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/2.0" },
  bySa3: { licence: "CC BY-SA 3.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/3.0" },
  bySa4: { licence: "CC BY-SA 4.0", licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0" },
  cc0: { licence: "CC0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0" },
  pd: { licence: "public domain", licenceUrl: "https://creativecommons.org/publicdomain/mark/1.0" },
} as const;

/** The picture of each Roast Line. */
export const pictures = new Map<ImpactId, Picture>([
  [
    "wikipedia",
    {
      ...licences.bySa3,
      alt: "Racks of servers of the Wikimedia Foundation, the machines that serve Wikipedia",
      author: "Victor Grigas",
      height: 640,
      page: "https://commons.wikimedia.org/wiki/File:Wikimedia_Foundation_Servers-8055_35.jpg",
      src: wikipedia,
      title: "Wikimedia Foundation Servers-8055 35",
      width: 960,
    },
  ],
  [
    "reading",
    {
      ...licences.pd,
      alt: "Margaret Hamilton beside a stack of printed Apollo flight software listings as tall as she is",
      author: "Draper Laboratory, restored by Adam Cuerden",
      height: 960,
      page: "https://commons.wikimedia.org/wiki/File:Margaret_Hamilton_-_restoration.jpg",
      src: reading,
      title: "Margaret Hamilton - restoration",
      width: 772,
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
  [
    "baths",
    {
      ...licences.cc0,
      alt: "Rows of fans on the cooling towers on the roof of a data center",
      author: "Rsparks3",
      height: 720,
      page: "https://commons.wikimedia.org/wiki/File:Data_center_cooling_tower.jpg",
      src: baths,
      title: "Data center cooling tower",
      width: 960,
    },
  ],
  [
    "laptops",
    {
      ...licences.bySa4,
      alt: "An open 16-inch MacBook Pro on a shop table, showing the Wikipedia home page",
      author: "Premeditated",
      height: 720,
      page: "https://commons.wikimedia.org/wiki/File:MacBook_Pro_16_(M1_Pro,_2021)_-_Wikipedia.jpg",
      src: laptops,
      title: "MacBook Pro 16 (M1 Pro, 2021) - Wikipedia",
      width: 960,
    },
  ],
  [
    "floppies",
    {
      ...licences.bySa4,
      alt: "A clipped stack of black 3.5-inch floppy disks in a museum case",
      author: "JIP",
      height: 720,
      page: "https://commons.wikimedia.org/wiki/File:Floppy_disks_and_ink_bottle_in_a_museum_at_the_Latvian_National_Library.jpg",
      src: floppies,
      title: "Floppy disks and ink bottle in a museum at the Latvian National Library",
      width: 960,
    },
  ],
]);

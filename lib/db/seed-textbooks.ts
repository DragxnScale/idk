import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";

/**
 * Seed data for the textbook catalog.
 *
 * sourceType "oer" = Open Educational Resource (free, legal).
 * sourceType "user_upload" = commercial book; user must upload their own copy.
 *
 * chapterPageRanges is a JSON string mapping chapter numbers to [start, end]
 * page numbers. These are approximate and let the viewer jump to chapters.
 */
export const seedTextbooks = [
  {
    id: "zumdahl-chemistry-7e",
    title: "Chemistry (Zumdahl)",
    edition: "7th",
    isbn: "978-0-618-52844-8",
    sourceType: "oer" as const,
    sourceUrl:
      "https://dn790008.ca.archive.org/0/items/chem-7-zumdahl/Zumdahl_Text.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [25, 62],
      "2": [63, 100],
      "3": [101, 150],
      "4": [151, 202],
      "5": [203, 252],
      "6": [253, 298],
      "7": [299, 353],
      "8": [354, 414],
      "9": [415, 448],
      "10": [449, 508],
      "11": [509, 550],
      "12": [551, 602],
      "13": [603, 646],
      "14": [647, 704],
      "15": [705, 772],
      "16": [773, 814],
      "17": [815, 864],
      "18": [865, 898],
      "19": [899, 924],
      "20": [925, 966],
      "21": [967, 1020],
      "22": [1021, 1081],
    }),
  },
  {
    id: "marshak-earth-portrait-2015",
    title: "Earth: Portrait of a Planet",
    edition: "2015",
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/stephen-marshak-earth-portrait-of-a-planet-w.-w.-norton-co-2015/Stephen%20Marshak-Earth_%20Portrait%20of%20a%20Planet-W.%20W.%20Norton%20%26%20Co%20%282015%29.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [2, 29],
      "2": [30, 69],
      "3": [70, 107],
      "4": [108, 145],
      "5": [146, 177],
      "6": [178, 213],
      "7": [214, 255],
      "8": [256, 293],
      "9": [294, 335],
      "10": [336, 379],
      "11": [380, 411],
      "12": [412, 455],
      "13": [456, 493],
      "14": [494, 535],
      "15": [536, 569],
      "16": [570, 611],
      "17": [612, 647],
      "18": [648, 685],
      "19": [686, 721],
      "20": [722, 755],
      "21": [756, 793],
      "22": [794, 831],
      "23": [832, 867],
    }),
  },
  {
    id: "serway-college-physics-9e",
    title: "College Physics (Serway, Vuille)",
    edition: "9th",
    isbn: "978-0-840-06206-2",
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/raymond-a.-serway-jerry-s-faughn-chris-vuille-college-physics-9th-edition-cengage-learning-2011/Raymond%20A.%20Serway%2C%20Jerry%20S%20Faughn%2C%20Chris%20Vuille%20-%20College%20Physics%2C%209th%20Edition-Cengage%20Learning%20%282011%29.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [1, 24],
      "2": [25, 55],
      "3": [56, 85],
      "4": [86, 123],
      "5": [124, 166],
      "6": [167, 197],
      "7": [198, 234],
      "8": [235, 276],
      "9": [277, 320],
      "10": [321, 351],
      "11": [352, 394],
      "12": [395, 426],
      "13": [427, 472],
      "14": [473, 512],
      "15": [513, 547],
      "16": [548, 589],
      "17": [590, 615],
      "18": [616, 647],
      "19": [648, 687],
      "20": [688, 722],
      "21": [723, 760],
      "22": [761, 789],
      "23": [790, 823],
      "24": [824, 858],
      "25": [859, 884],
      "26": [885, 910],
      "27": [911, 933],
      "28": [934, 956],
      "29": [957, 981],
      "30": [982, 1010],
    }),
  },
  {
    id: "seeds-astronomy-solar-system-beyond",
    title: "Astronomy: The Solar System and Beyond (Seeds, Backman)",
    edition: null,
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/michael-a.-michael-a.-seeds-seeds-dana-backman-astronomy-the-solar-system-and-be/Michael%20A.%28Michael%20A.%20Seeds%29%20Seeds%2C%20Dana%20Backman%20-%20Astronomy_%20The%20Solar%20System%20and%20Beyond-Brooks%20Cole%20%282009%29.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [1, 15],
      "2": [16, 26],
      "3": [27, 41],
      "4": [42, 67],
      "5": [68, 95],
      "6": [96, 107],
      "7": [108, 130],
      "8": [131, 165],
      "9": [166, 190],
      "10": [191, 213],
      "11": [214, 235],
      "12": [236, 265],
      "13": [266, 291],
      "14": [292, 317],
      "15": [318, 340],
      "16": [341, 366],
      "17": [367, 389],
      "18": [390, 402],
      "19": [403, 427],
      "20": [428, 445],
    }),
  },
  {
    id: "seeds-foundations-astronomy-2011",
    title: "Foundations of Astronomy (Seeds, Backman)",
    edition: "2011",
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/michael-a.-seeds-dana-backman-foundations-of-astronomy-brooks-cole-cengage-learning-2011/Michael%20A.%20Seeds%2C%20Dana%20Backman%20-%20Foundations%20of%20Astronomy-Brooks_Cole%2C%20Cengage%20Learning%20%282011%29.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [1, 12],
      "2": [13, 30],
      "3": [31, 48],
      "4": [49, 75],
      "5": [76, 97],
      "6": [98, 121],
      "7": [122, 142],
      "8": [143, 166],
      "9": [167, 195],
      "10": [196, 209],
      "11": [210, 231],
      "12": [232, 254],
      "13": [255, 277],
      "14": [278, 301],
      "15": [302, 329],
      "16": [330, 352],
      "17": [353, 367],
      "18": [368, 395],
      "19": [396, 419],
      "20": [420, 441],
      "21": [442, 463],
      "22": [464, 488],
      "23": [489, 519],
      "24": [520, 550],
      "25": [551, 580],
      "26": [581, 602],
    }),
  },
];

export async function ensureSeeded() {
  const now = new Date();
  for (const book of seedTextbooks) {
    await db
      .insert(textbookCatalog)
      .values({ ...book, createdAt: now })
      .onConflictDoUpdate({
        target: textbookCatalog.id,
        set: {
          chapterPageRanges: book.chapterPageRanges,
          sourceUrl: book.sourceUrl,
        },
      });
  }
}

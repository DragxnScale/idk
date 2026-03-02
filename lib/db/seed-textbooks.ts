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
      "1": [37, 64],
      "2": [65, 104],
      "3": [105, 142],
      "4": [143, 180],
      "5": [181, 212],
      "6": [213, 248],
      "7": [249, 290],
      "8": [291, 328],
      "9": [329, 370],
      "10": [371, 414],
      "11": [415, 446],
      "12": [447, 490],
      "13": [491, 528],
      "14": [529, 570],
      "15": [571, 604],
      "16": [605, 646],
      "17": [647, 682],
      "18": [683, 720],
      "19": [721, 756],
      "20": [757, 790],
      "21": [791, 828],
      "22": [829, 866],
      "23": [867, 902],
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
      "1": [35, 58],
      "2": [59, 89],
      "3": [90, 119],
      "4": [120, 157],
      "5": [158, 200],
      "6": [201, 231],
      "7": [232, 268],
      "8": [269, 310],
      "9": [311, 354],
      "10": [355, 385],
      "11": [386, 428],
      "12": [429, 460],
      "13": [461, 506],
      "14": [507, 546],
      "15": [547, 581],
      "16": [582, 623],
      "17": [624, 649],
      "18": [650, 681],
      "19": [682, 721],
      "20": [722, 756],
      "21": [757, 794],
      "22": [795, 823],
      "23": [824, 857],
      "24": [858, 892],
      "25": [893, 918],
      "26": [919, 944],
      "27": [945, 967],
      "28": [968, 990],
      "29": [991, 1015],
      "30": [1016, 1044],
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
      "1": [19, 33],
      "2": [34, 44],
      "3": [45, 59],
      "4": [60, 85],
      "5": [86, 113],
      "6": [114, 125],
      "7": [126, 148],
      "8": [149, 183],
      "9": [184, 208],
      "10": [209, 231],
      "11": [232, 253],
      "12": [254, 283],
      "13": [284, 309],
      "14": [310, 335],
      "15": [336, 358],
      "16": [359, 384],
      "17": [385, 407],
      "18": [408, 420],
      "19": [421, 445],
      "20": [446, 463],
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
      "1": [17, 28],
      "2": [29, 46],
      "3": [47, 64],
      "4": [65, 91],
      "5": [92, 113],
      "6": [114, 137],
      "7": [138, 158],
      "8": [159, 182],
      "9": [183, 211],
      "10": [212, 225],
      "11": [226, 247],
      "12": [248, 270],
      "13": [271, 293],
      "14": [294, 317],
      "15": [318, 345],
      "16": [346, 368],
      "17": [369, 383],
      "18": [384, 411],
      "19": [412, 435],
      "20": [436, 457],
      "21": [458, 479],
      "22": [480, 504],
      "23": [505, 535],
      "24": [536, 566],
      "25": [567, 596],
      "26": [597, 618],
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

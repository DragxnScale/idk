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
    id: "openstax-chemistry-2e",
    title: "Chemistry 2e",
    edition: "2nd",
    isbn: "978-1-947172-61-6",
    sourceType: "oer" as const,
    sourceUrl: "https://openstax.org/details/books/chemistry-2e",
    chapterPageRanges: JSON.stringify({
      "1": [1, 38],
      "2": [39, 82],
      "3": [83, 126],
      "4": [127, 172],
      "5": [173, 216],
      "6": [217, 268],
      "7": [269, 312],
      "8": [313, 354],
      "9": [355, 398],
      "10": [399, 444],
    }),
  },
  {
    id: "openstax-biology-2e",
    title: "Biology 2e",
    edition: "2nd",
    isbn: "978-1-947172-51-7",
    sourceType: "oer" as const,
    sourceUrl: "https://openstax.org/details/books/biology-2e",
    chapterPageRanges: JSON.stringify({
      "1": [1, 30],
      "2": [31, 60],
      "3": [61, 96],
      "4": [97, 130],
      "5": [131, 168],
      "6": [169, 200],
      "7": [201, 240],
      "8": [241, 276],
    }),
  },
  {
    id: "zumdahl-chemistry-7e",
    title: "Chemistry (Zumdahl)",
    edition: "7th",
    isbn: "978-0-618-52844-8",
    sourceType: "oer" as const,
    sourceUrl:
      "https://dn790008.ca.archive.org/0/items/chem-7-zumdahl/Zumdahl_Text.pdf",
    chapterPageRanges: JSON.stringify({
      "1": [33, 72],
      "2": [73, 116],
      "3": [117, 166],
      "4": [167, 218],
      "5": [219, 272],
      "6": [273, 324],
      "7": [325, 378],
      "8": [379, 434],
      "9": [435, 488],
      "10": [489, 538],
      "11": [539, 586],
      "12": [587, 636],
      "13": [637, 686],
      "14": [687, 732],
      "15": [733, 778],
      "16": [779, 820],
      "17": [821, 870],
      "18": [871, 918],
      "19": [919, 950],
      "20": [951, 990],
      "21": [991, 1042],
    }),
  },
  {
    id: "openstax-physics",
    title: "University Physics Volume 1",
    edition: "1st",
    isbn: "978-1-947172-20-3",
    sourceType: "oer" as const,
    sourceUrl: "https://openstax.org/details/books/university-physics-volume-1",
    chapterPageRanges: JSON.stringify({
      "1": [1, 36],
      "2": [37, 74],
      "3": [75, 118],
      "4": [119, 164],
      "5": [165, 206],
      "6": [207, 250],
    }),
  },
];

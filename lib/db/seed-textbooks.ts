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
  {
    id: "marshak-earth-portrait-2015",
    title: "Earth: Portrait of a Planet",
    edition: "2015",
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/stephen-marshak-earth-portrait-of-a-planet-w.-w.-norton-co-2015/stephen-marshak-earth-portrait-of-a-planet-w.-w.-norton-co-2015.pdf",
    chapterPageRanges: null,
  },
];

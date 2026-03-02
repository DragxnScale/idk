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
    chapterPageRanges: null,
  },
  {
    id: "seeds-astronomy-solar-system-beyond",
    title: "Astronomy: The Solar System and Beyond (Seeds, Backman)",
    edition: null,
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/michael-a.-michael-a.-seeds-seeds-dana-backman-astronomy-the-solar-system-and-be/Michael%20A.%28Michael%20A.%20Seeds%29%20Seeds%2C%20Dana%20Backman%20-%20Astronomy_%20The%20Solar%20System%20and%20Beyond-Brooks%20Cole%20%282009%29.pdf",
    chapterPageRanges: null,
  },
  {
    id: "seeds-foundations-astronomy-2011",
    title: "Foundations of Astronomy (Seeds, Backman)",
    edition: "2011",
    isbn: null,
    sourceType: "oer" as const,
    sourceUrl:
      "https://archive.org/download/michael-a.-seeds-dana-backman-foundations-of-astronomy-brooks-cole-cengage-learning-2011/Michael%20A.%20Seeds%2C%20Dana%20Backman%20-%20Foundations%20of%20Astronomy-Brooks_Cole%2C%20Cengage%20Learning%20%282011%29.pdf",
    chapterPageRanges: null,
  },
];

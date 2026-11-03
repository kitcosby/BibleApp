/**
 * The single source of corpus content. A full public-domain corpus export can
 * replace these constants without changing the reading or interlinear UI.
 * IDs identify graphic-word occurrences, not lexemes (Strong's identifies those).
 * VersePart arrays are explicit display-order alignments: preserve punctuation,
 * conjunctions, possessives and reordered English without string replacement.
 * Young's word alignment is computed, not an authoritative published interlinear.
 */
export interface Word {
  id: string;
  hebrew: string;
  transliteration: string;
  strongs: string;
  gloss: string;
  grammar: string;
  kjv: string;
  youngs: string;
}
export interface WitnessNote { witness: string; text: string }
export interface VersePart { text: string; wordId?: string; strongs?: string }
export interface Verse {
  id: string;
  book: string;
  chapter: number;
  number: number;
  reference: string;
  kjv: string;
  youngs: string;
  words: Word[];
  kjvParts: VersePart[];
  youngsParts: VersePart[];
  witnessNotes: WitnessNote[];
}
/**
 * SearchResult is the contract for the project's own future search engine:
 * semantic search over Bible-database verse embeddings, nomic-embed-text,
 * 768 dimensions, one vector per verse, served by the project's API.
 * This bundled provider implements the same async contract; replace the
 * provider with an API request, not the search UI, when that data path exists.
 * Scores below are supplied prototype examples, NOT computed vector scores.
 */
export interface SearchResult { reference: string; text: string; score: number; href?: string }

type WordRow = [string, string, string, string, string, string, string];
function wordRows(verse: number, rows: WordRow[]): Word[] {
  return rows.map(([hebrew, transliteration, strongs, gloss, grammar, kjv, youngs], i) => ({
    id: `gen-1-${verse}-w${i + 1}`, hebrew, transliteration, strongs, gloss, grammar, kjv, youngs,
  }));
}
const words1 = wordRows(1, [
  ["בְּרֵאשִׁית", "bereshit", "H7225", "in beginning", "preposition + noun · feminine · singular · construct", "In the beginning", "In the beginning"],
  ["בָּרָא", "bara", "H1254", "created", "verb · Qal perfect · 3rd masculine singular", "created", "preparing"],
  ["אֱלֹהִים", "Elohim", "H430", "God", "noun · masculine · plural · absolute", "God", "God"],
  ["אֵת", "et", "H853", "(object marker)", "direct object marker", "(untranslated)", "(untranslated)"],
  ["הַשָּׁמַיִם", "hashamayim", "H8064", "the heavens", "definite article + noun · masculine · plural · absolute", "the heavens", "the heavens"],
  ["וְאֵת", "ve'et", "H853", "and + (object marker)", "conjunction + direct object marker", "and", "and"],
  ["הָאָרֶץ", "ha'aretz", "H776", "the earth", "definite article + noun · singular · absolute", "the earth", "the earth"],
]);
const words2 = wordRows(2, [
  ["וְהָאָרֶץ", "veha'aretz", "H776", "and the earth", "conjunction + article + noun · singular · absolute", "And the earth", "the earth"],
  ["הָיְתָה", "hayetah", "H1961", "was", "verb · Qal perfect · 3rd feminine singular", "was", "hath existed"],
  ["תֹהוּ", "tohu", "H8414", "waste, formlessness", "noun · masculine · singular · absolute", "without form", "waste"],
  ["וָבֹהוּ", "vavohu", "H922", "and emptiness", "conjunction + noun · masculine · singular · absolute", "and void", "and void"],
  ["וְחֹשֶׁךְ", "vechoshekh", "H2822", "and darkness", "conjunction + noun · masculine · singular · absolute", "and darkness", "and darkness"],
  ["עַל־פְּנֵי", "al-penei", "H6440", "upon the face of", "noun · plural · construct", "upon the face of", "on the face of"],
  ["תְהוֹם", "tehom", "H8415", "the deep", "noun · singular · absolute", "the deep", "the deep"],
  ["וְרוּחַ", "veruach", "H7307", "and the Spirit", "conjunction + noun · singular · construct", "And the Spirit", "and the Spirit"],
  ["אֱלֹהִים", "Elohim", "H430", "God", "noun · masculine · plural · absolute", "God", "God"],
  ["מְרַחֶפֶת", "merachefet", "H7363", "hovering", "verb · Piel participle · feminine singular", "moved", "fluttering"],
  ["עַל־פְּנֵי", "al-penei", "H6440", "upon the face of", "noun · plural · construct", "upon the face of", "on the face of"],
  ["הַמָּיִם", "hamayim", "H4325", "the waters", "definite article + noun · masculine · plural · absolute", "the waters", "the waters"],
]);
const words3 = wordRows(3, [
  ["וַיֹּאמֶר", "vayomer", "H559", "and he said", "conjunction + verb · Qal wayyiqtol · 3rd masculine singular", "said", "saith"],
  ["אֱלֹהִים", "Elohim", "H430", "God", "noun · masculine · plural · absolute", "God", "God"],
  ["יְהִי", "yehi", "H1961", "let there be", "verb · Qal jussive · 3rd masculine singular", "Let there be", "Let be"],
  ["אוֹר", "'or", "H216", "light", "noun · singular · absolute", "light", "light"],
  ["וַיְהִי־אוֹר", "vayehi-'or", "H216", "and there was light", 'combined graphic word: verb Qal wayyiqtol 3rd masc. sg. + noun "light"', "and there was light", "and light is"],
]);
const literal = (text: string): VersePart => ({ text });
const mapped = (words: Word[], index: number, text?: string): VersePart => {
  const word = words[index - 1]!;
  return { text: text ?? word.kjv, wordId: word.id, strongs: word.strongs };
};
const lexeme = (strongs: string, text: string): VersePart => ({ strongs, text });
const v1K = [mapped(words1, 1), literal(" "), mapped(words1, 3), literal(" "), mapped(words1, 2), literal(" "), mapped(words1, 5), literal(" "), mapped(words1, 6), literal(" "), mapped(words1, 7), literal(".")];
const v1Y = [mapped(words1, 1), literal(" of "), mapped(words1, 3), literal("'s "), mapped(words1, 2, "preparing"), literal(" "), mapped(words1, 5), literal(" "), mapped(words1, 6), literal(" "), mapped(words1, 7), literal(" —")];
const v2K = [
  mapped(words2, 1), literal(" "), mapped(words2, 2), literal(" "), mapped(words2, 3), literal(", "), mapped(words2, 4), literal("; "), mapped(words2, 5), literal(" was "),
  mapped(words2, 6), literal(" "), mapped(words2, 7), literal(". "), mapped(words2, 8), literal(" of "), mapped(words2, 9), literal(" "), mapped(words2, 10), literal(" "), mapped(words2, 11), literal(" "), mapped(words2, 12), literal("."),
];
const v2Y = [
  mapped(words2, 1, "the earth"), literal(" "), mapped(words2, 2, "hath existed"), literal(" "), mapped(words2, 3, "waste"), literal(" "), mapped(words2, 4), literal(", "), mapped(words2, 5), literal(" [is] "),
  mapped(words2, 6, "on the face of"), literal(" "), mapped(words2, 7), literal(", "), mapped(words2, 8, "and the Spirit"), literal(" of "), mapped(words2, 9), literal(" "), mapped(words2, 10, "fluttering"), literal(" "), mapped(words2, 11, "on the face of"), literal(" "), mapped(words2, 12), literal(","),
];
const v3K = [literal("And "), mapped(words3, 2), literal(" "), mapped(words3, 1), literal(", "), mapped(words3, 3), literal(" "), mapped(words3, 4), literal(": "), mapped(words3, 5), literal(".")];
// The jussive's English phrase is discontinuous: display-order parts retain
// the exact Young's base while marking the second fragment as literal.
const v3Y = [literal("and "), mapped(words3, 2), literal(" "), mapped(words3, 1, "saith"), literal(", '"), mapped(words3, 3, "Let"), literal(" "), mapped(words3, 4), literal(" be;' "), mapped(words3, 5, "and light is"), literal(".")];
const v4K = [literal("And "), lexeme("H430", "God"), literal(" saw "), lexeme("H216", "the light"), literal(", that it was good: and "), lexeme("H430", "God"), literal(" divided "), lexeme("H216", "the light"), literal(" from "), lexeme("H2822", "the darkness"), literal(".")];
const v5K = [literal("And "), lexeme("H430", "God"), literal(" called "), lexeme("H216", "the light"), literal(" Day, and "), lexeme("H2822", "the darkness"), literal(" he called Night. And the evening and the morning were the first day.")];
function verse(number: number, words: Word[], kjvParts: VersePart[], youngsParts: VersePart[], witnessNotes: WitnessNote[] = []): Verse {
  return { id: `gen-1-${number}`, book: "Genesis", chapter: 1, number, reference: `Genesis 1:${number}`, words, kjvParts, youngsParts, kjv: kjvParts.map(p => p.text).join(""), youngs: youngsParts.map(p => p.text).join(""), witnessNotes };
}
export const verses: Verse[] = [
  verse(1, words1, v1K, v1Y, [
    { witness: "SP", text: "Samaritan Pentateuch: no variant in this verse." },
    { witness: "Syr", text: "Peshitta verse text available for this verse — tap to compare at verse scale." },
  ]),
  verse(2, words2, v2K, v2Y),
  verse(3, words3, v3K, v3Y),
  verse(4, [], v4K, []),
  verse(5, [], v5K, []),
];
export const books = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
];
export const witnesses = [
  { value: "masoretic", label: "Masoretic", note: "Pointed Masoretic sample text shown. No per-word apparatus is bundled." },
  { value: "samaritan", label: "Samaritan", note: "No per-word Samaritan reading is bundled. See the verse-scale notes where available." },
  { value: "dss", label: "Dead Sea Scrolls", note: "No per-word Dead Sea Scrolls reading is bundled for these sample verses." },
];
export const elohim = {
  hebrew: "אֱלֹהִים", transliteration: "Elohim", strongs: "H430", partOfSpeech: "noun masculine plural",
  kjvRenderings: ["God", "god", "gods", "judges", "angels"],
  youngsRenderings: ["God", "gods"],
  witnessNotes: [{ witness: "1QIsa-a", text: "Addition: אוֹר 'light' after יִרְאֶה — Dead Sea Scrolls, Isaiah 53:11." }],
  occurrences: [1, 2, 3, 4, 5, 6].map(verse => ({ reference: `Genesis 1:${verse}`, verse, inSample: verse <= 3 })),
};
export const searchResults: SearchResult[] = [
  { reference: "Genesis 1:3", text: "And God said, Let there be light: and there was light.", score: 0.91, href: "/interlinear#v3" },
  { reference: "Psalm 27:1", text: "The LORD is my light and my salvation; whom shall I fear?", score: 0.86 },
  { reference: "Isaiah 9:2", text: "The people that walked in darkness have seen a great light…", score: 0.84 },
  { reference: "Isaiah 60:1", text: "Arise, shine; for thy light is come…", score: 0.81 },
];
export type SearchProvider = (query: string) => Promise<SearchResult[]>;
export const searchCorpus: SearchProvider = async query =>
  /light|dark/i.test(query) ? searchResults.map(result => ({ ...result })) : [];

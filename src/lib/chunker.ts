import type { Paragraph } from "./parsers";

export interface Chunk {
  startIdx: number; // first word index in this chunk
  endIdx: number;   // last word index in this chunk (inclusive)
}

// Words that signal the START of a new clause in Spanish & English
// → when we encounter them, we prefer to break BEFORE them
const BREAK_BEFORE = new Set([
  "y", "e", "o", "u", "pero", "sino", "aunque", "que", "si",
  "cuando", "como", "porque", "mientras", "donde", "para", "pues", "ni",
  "and", "but", "or", "if", "when", "because", "while", "where", "that",
]);

/**
 * Groups words into phrase-level chunks for display.
 * Never creates a chunk that crosses a paragraph boundary.
 */
export function buildChunks(
  words: string[],
  paragraphs: Paragraph[],
  groupSize: number
): Chunk[] {
  // Group size 1 → each word is its own chunk (classic RSVP)
  if (groupSize <= 1) {
    return words.map((_, i) => ({ startIdx: i, endIdx: i }));
  }

  // paragraph end indices — hard stop for any chunk
  const paraEndSet = new Set(paragraphs.map((p) => p.endIdx));

  const chunks: Chunk[] = [];
  let i = 0;

  while (i < words.length) {
    const start = i;
    let count = 0;

    while (i < words.length && count < groupSize) {
      const word = words[i];
      const lastChar = word[word.length - 1] || "";

      i++;
      count++;

      // Hard stop at paragraph boundary
      if (paraEndSet.has(i - 1)) break;

      // Break after sentence-ending punctuation
      if ([".","!","?","…"].includes(lastChar)) break;

      // Break after clause punctuation once we have ≥1 word
      if ([",",";",":"].includes(lastChar)) break;

      // Break BEFORE a conjunction if we already have ≥2 words
      if (count >= 2 && i < words.length) {
        const nextClean = words[i].toLowerCase().replace(/[^a-záéíóúüña-z]/gi, "");
        if (BREAK_BEFORE.has(nextClean)) break;
      }
    }

    chunks.push({ startIdx: start, endIdx: i - 1 });
  }

  return chunks;
}

/**
 * Find the chunk index that contains a given word index.
 */
export function findChunkForWord(chunks: Chunk[], wordIdx: number): number {
  // Binary search for performance on large documents
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid].endIdx < wordIdx) lo = mid + 1;
    else if (chunks[mid].startIdx > wordIdx) hi = mid - 1;
    else return mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * Splits a word into [bold, normal] parts for Bionic Reading.
 * Bolding the first ~45% of letters helps the brain recognize words faster.
 */
export function bionicSplit(word: string): [string, string] {
  const letters = (word.match(/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/g) || []).length;
  if (letters <= 1) return [word, ""];

  const boldLetterCount = Math.max(1, Math.ceil(letters * 0.45));
  let seen = 0;

  for (let i = 0; i < word.length; i++) {
    if (/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]/.test(word[i])) {
      seen++;
      if (seen === boldLetterCount) {
        return [word.slice(0, i + 1), word.slice(i + 1)];
      }
    }
  }
  return [word, ""];
}

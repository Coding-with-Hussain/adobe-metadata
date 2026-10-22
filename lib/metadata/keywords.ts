import type { KeywordStyle } from "./settings";
import { cleanInline } from "./text";

/**
 * Keyword post-processing. Semantics (also documented in the README):
 *
 * - Comparison is case-insensitive and Unicode-normalized (NFKC); the first
 *   occurrence wins and keeps its original capitalization.
 * - `single`: every keyword is one word; multi-word phrases are split into
 *   words (stop words dropped) in their original relevance order.
 * - `double`: every keyword is exactly two words; other lengths are dropped.
 * - `auto`: keywords of one to three words; longer phrases are dropped.
 * - Excluded terms remove any keyword that contains the term as a whole word
 *   or phrase ("dog" removes "dog" and "dog park" but not "hotdog").
 * - Include terms the model did not mark as inapplicable are guaranteed a
 *   slot. They keep the model's position when the model already used them,
 *   otherwise they are appended. They bypass the style filter because the
 *   user asked for them verbatim. Terms Gemini reports as not matching the
 *   asset are not added; a review flag is raised instead.
 * - Excessively generic terms ("image", "stock photo", ...) are removed.
 */

export const MAX_KEYWORD_LENGTH = 60;

export const GENERIC_KEYWORDS = new Set(
  [
    "image",
    "images",
    "photo",
    "photos",
    "photograph",
    "picture",
    "pictures",
    "pic",
    "pics",
    "stock",
    "stock photo",
    "stock image",
    "stock footage",
    "stock video",
    "royalty free",
    "royalty-free",
    "high quality",
    "high resolution",
    "jpg",
    "jpeg",
    "png",
    "file",
    "untitled",
    "keyword",
    "keywords",
  ].map((k) => keywordKey(k)),
);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function keywordKey(keyword: string): string {
  return keyword.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Clean a raw keyword. Returns an empty string for malformed input. */
export function normalizeKeyword(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let k = cleanInline(raw)
    .replace(/^[\s"'`#*•·\-–—.,;:]+/u, "")
    .replace(/[\s"'`*•·\-–—.,;:!?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  // Must contain at least one letter or digit.
  if (!/[\p{L}\p{N}]/u.test(k)) return "";
  if (Array.from(k).length > MAX_KEYWORD_LENGTH) return "";
  // Collapse internal commas: a keyword must not smuggle in several keywords.
  if (k.includes(",")) k = "";
  return k;
}

export function wordCount(keyword: string): number {
  return keyword.split(/\s+/).filter(Boolean).length;
}

export function applyKeywordStyle(keywords: string[], style: KeywordStyle): string[] {
  if (style === "single") {
    const out: string[] = [];
    for (const k of keywords) {
      for (const word of k.split(/\s+/)) {
        const w = normalizeKeyword(word);
        if (w && !STOP_WORDS.has(keywordKey(w))) out.push(w);
      }
    }
    return out;
  }
  if (style === "double") return keywords.filter((k) => wordCount(k) === 2);
  return keywords.filter((k) => wordCount(k) <= 3);
}

export function dedupeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const key = keywordKey(k);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `keyword` contains `term` as a whole word or phrase (case-insensitive). */
export function containsTerm(keyword: string, term: string): boolean {
  const k = keywordKey(keyword);
  const t = keywordKey(term);
  if (!t) return false;
  if (k === t) return true;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}($|[^\\p{L}\\p{N}])`, "u");
  return re.test(k);
}

export interface KeywordOptions {
  count: number;
  style: KeywordStyle;
  includeTerms: string[];
  excludeTerms: string[];
  /** Include terms Gemini reported as not matching the asset. */
  inapplicableIncludeTerms?: string[];
}

export interface KeywordResult {
  keywords: string[];
  /** Human-readable review notices produced while enforcing the rules. */
  flags: string[];
}

export function processKeywords(raw: unknown[], options: KeywordOptions): KeywordResult {
  const flags: string[] = [];
  const excluded = options.excludeTerms.map(normalizeKeyword).filter(Boolean);
  const isExcluded = (k: string) => excluded.some((term) => containsTerm(k, term));

  let list = raw.map(normalizeKeyword).filter(Boolean);
  list = applyKeywordStyle(list, options.style);
  list = list.filter((k) => !GENERIC_KEYWORDS.has(keywordKey(k)));
  list = list.filter((k) => !isExcluded(k));
  list = dedupeKeywords(list);

  // Resolve include terms.
  const inapplicable = new Set((options.inapplicableIncludeTerms ?? []).map(keywordKey));
  const mandatory: string[] = [];
  for (const termRaw of dedupeKeywords(options.includeTerms.map(normalizeKeyword).filter(Boolean))) {
    if (isExcluded(termRaw)) {
      flags.push(`Include term "${termRaw}" is also excluded, so it was left out.`);
    } else if (inapplicable.has(keywordKey(termRaw))) {
      flags.push(`Include term "${termRaw}" may not match this asset, so it was not added. Add it manually if it applies.`);
    } else {
      mandatory.push(termRaw);
    }
  }

  const count = Math.max(0, options.count);
  if (mandatory.length > count) {
    flags.push(`Only the first ${count} include terms fit the keyword limit.`);
    mandatory.length = count;
  }
  const mandatoryKeys = new Set(mandatory.map(keywordKey));
  let slotsForOthers = count - mandatory.length;
  const result: string[] = [];
  const placed = new Set<string>();
  for (const k of list) {
    const key = keywordKey(k);
    if (mandatoryKeys.has(key)) {
      result.push(k);
      placed.add(key);
    } else if (slotsForOthers > 0) {
      result.push(k);
      slotsForOthers--;
    }
  }
  for (const m of mandatory) {
    if (!placed.has(keywordKey(m))) result.push(m);
  }

  // Falling short of the target is reported as a validation warning (see validateMetadata), not a review flag:
  // the app never invents keywords to fill the count.
  return { keywords: result, flags };
}

/**
 * Unicode-aware text helpers.
 *
 * Length semantics: lengths are measured in Unicode code points
 * (`Array.from(str).length`), which is how most stock marketplaces count
 * characters and never double-counts astral characters such as emoji.
 * Truncation never splits a grapheme cluster (e.g. an emoji with a skin-tone
 * modifier or a letter with combining accents).
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\uFEFF]/g;
const TRAILING_JOINERS = /[\s,;:/&\-–—(]+$/u;

export function charCount(value: string): number {
  return Array.from(value).length;
}

/** Remove control characters and collapse all whitespace (including newlines) to single spaces. */
export function cleanInline(value: string): string {
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

function graphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (s) => s.segment);
  }
  return Array.from(value);
}

/**
 * Truncate to at most `max` code points. Prefers to cut at a word boundary
 * when that keeps at least half of the allowed length, then strips trailing
 * separators. The result always satisfies `charCount(result) <= max`.
 */
export function truncateText(value: string, max: number): string {
  const text = value.trim();
  if (max <= 0) return "";
  if (charCount(text) <= max) return text;

  const parts = graphemes(text);
  let used = 0;
  let cutIndex = 0;
  for (; cutIndex < parts.length; cutIndex++) {
    const len = charCount(parts[cutIndex]);
    if (used + len > max) break;
    used += len;
  }
  let cut = parts.slice(0, cutIndex).join("");
  const nextChar = parts[cutIndex] ?? "";
  const cutMidWord = nextChar !== "" && !/\s/.test(nextChar);

  if (cutMidWord) {
    const lastSpace = cut.search(/\s\S*$/);
    if (lastSpace > 0 && charCount(cut.slice(0, lastSpace)) >= Math.floor(max / 2)) {
      cut = cut.slice(0, lastSpace);
    }
  }
  cut = cut.replace(TRAILING_JOINERS, "").trim();
  // Defensive final check; should already hold.
  while (charCount(cut) > max) cut = Array.from(cut).slice(0, max).join("").trim();
  return cut;
}

export interface ComposeResult {
  value: string;
  truncated: boolean;
  /** Set when the prefix/suffix leave no room for the generated text. */
  error?: string;
}

/**
 * Compose `prefix + body + suffix` (joined by single spaces) so that the
 * final string fits `max`. Only the body is shortened; prefix and suffix are
 * kept verbatim because the user asked for them explicitly.
 */
export function composeWithAffixes(body: string, prefix: string, suffix: string, max: number): ComposeResult {
  const p = cleanInline(prefix);
  const s = cleanInline(suffix);
  const b = cleanInline(body);
  const fixed = charCount(p) + charCount(s) + (p ? 1 : 0) + (s ? 1 : 0);
  const budget = max - fixed;

  if (budget < 1) {
    const value = [p, s].filter(Boolean).join(" ");
    return {
      value: charCount(value) <= max ? value : truncateText(value, max),
      truncated: true,
      error: `Prefix and suffix use ${fixed} of ${max} characters, leaving no room for the generated text.`,
    };
  }

  const truncatedBody = truncateText(b, budget);
  const value = [p, truncatedBody, s].filter(Boolean).join(" ");
  return { value, truncated: truncatedBody !== b };
}

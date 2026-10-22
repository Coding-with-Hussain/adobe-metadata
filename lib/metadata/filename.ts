import { getExtension } from "@/lib/config/limits";
import { processKeywords } from "./keywords";
import type { GenerationSettings } from "./settings";
import { cleanInline } from "./text";

/**
 * Filename semantics:
 *
 * - "Filename as title": the title comes from `filenameToTitle()`; Gemini
 *   still analyses the media for the description and keywords (unless
 *   filename-only mode is on).
 * - "Filename only": no media is sent to Gemini. Title, description and
 *   keywords are derived deterministically from the filename text by
 *   `filenameOnlyMetadata()`. Filename-only always takes precedence.
 */

const CAMERA_PREFIXES = new Set([
  "img",
  "dsc",
  "dscf",
  "dscn",
  "dji",
  "mvi",
  "vid",
  "pxl",
  "gopr",
  "gh",
  "mov",
  "clip",
  "final",
  "edit",
  "copy",
  "export",
]);

/** Camera/export noise such as "IMG", "DSC0042" or "copy". */
function isCameraToken(word: string): boolean {
  const m = /^(\p{L}+)\d*$/u.exec(word);
  return m !== null && CAMERA_PREFIXES.has(m[1].toLocaleLowerCase());
}

/** Split a filename (without extension) into human words. */
export function filenameWords(filename: string): string[] {
  const ext = getExtension(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  const spaced = base
    // Remove bracketed counters such as "(1)" or "[2]".
    .replace(/[([{]\s*\d+\s*[)\]}]/g, " ")
    // Separate camelCase words.
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    // Treat common separators as spaces.
    .replace(/[_\-.+~,;:!@#$%^&*=|\\/()[\]{}<>"'`]+/g, " ");

  return cleanInline(spaced)
    .split(" ")
    .filter((w) => w && /\p{L}/u.test(w) && !isCameraToken(w));
}

/** Sentence-case title derived from a filename; empty when nothing usable remains. */
export function filenameToTitle(filename: string): string {
  const words = filenameWords(filename);
  if (words.length === 0) return "";
  const isAcronym = (w: string) => /^\p{Lu}{2,}$/u.test(w);
  // Keep acronyms ("NYC") unless the whole filename is shouted in capitals.
  const keepAcronyms = !words.every(isAcronym);
  const lower = words.map((w) => (keepAcronyms && isAcronym(w) ? w : w.toLocaleLowerCase()));
  const first = lower[0];
  lower[0] = first.charAt(0).toLocaleUpperCase() + first.slice(1);
  return lower.join(" ");
}

export interface FilenameMetadata {
  title: string;
  description: string;
  keywords: string[];
  flags: string[];
}

/** Deterministic, offline metadata used in filename-only mode. Never calls Gemini. */
export function filenameOnlyMetadata(filename: string, settings: GenerationSettings): FilenameMetadata {
  const title = filenameToTitle(filename);
  const flags = ["Filename-only mode: derived from the filename text without looking at the media. Check it matches the asset."];
  if (!title) {
    flags.push("The filename contains no usable words, so title, description and keywords are empty.");
    return { title: "", description: "", keywords: [], flags };
  }
  const words = filenameWords(filename).map((w) => w.toLocaleLowerCase());
  const bigrams = words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);
  const candidates =
    settings.keywordStyle === "single" ? words : settings.keywordStyle === "double" ? bigrams : [...words, ...bigrams];

  const kw = processKeywords(candidates, {
    count: settings.keywordCount,
    style: settings.keywordStyle,
    includeTerms: settings.includeTerms,
    excludeTerms: settings.excludeTerms,
  });
  return { title, description: `${title}.`, keywords: kw.keywords, flags: [...flags, ...kw.flags] };
}

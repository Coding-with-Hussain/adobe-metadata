import { z } from "zod";

export const KEYWORD_STYLES = ["auto", "single", "double"] as const;
export type KeywordStyle = (typeof KEYWORD_STYLES)[number];

export const SVG_MODES = ["standard", "silhouette"] as const;
export const PNG_BACKGROUNDS = ["transparent", "white", "black"] as const;

export const SETTINGS_BOUNDS = {
  titleMaxChars: { min: 10, max: 500 },
  descriptionMaxChars: { min: 20, max: 2000 },
  keywordCount: { min: 1, max: 50 },
  terms: { maxItems: 25, maxLength: 60 },
  affix: { maxLength: 60 },
} as const;

const term = z.string().trim().min(1).max(SETTINGS_BOUNDS.terms.maxLength);
const affix = z.string().max(SETTINGS_BOUNDS.affix.maxLength);

export const generationSettingsSchema = z.object({
  titleMaxChars: z.number().int().min(SETTINGS_BOUNDS.titleMaxChars.min).max(SETTINGS_BOUNDS.titleMaxChars.max),
  descriptionMaxChars: z
    .number()
    .int()
    .min(SETTINGS_BOUNDS.descriptionMaxChars.min)
    .max(SETTINGS_BOUNDS.descriptionMaxChars.max),
  keywordCount: z.number().int().min(SETTINGS_BOUNDS.keywordCount.min).max(SETTINGS_BOUNDS.keywordCount.max),
  keywordStyle: z.enum(KEYWORD_STYLES),
  includeTerms: z.array(term).max(SETTINGS_BOUNDS.terms.maxItems),
  excludeTerms: z.array(term).max(SETTINGS_BOUNDS.terms.maxItems),
  filenameAsTitle: z.boolean(),
  filenameOnly: z.boolean(),
  titlePrefix: affix,
  titleSuffix: affix,
  descriptionPrefix: affix,
  descriptionSuffix: affix,
  svgMode: z.enum(SVG_MODES),
  pngBackground: z.enum(PNG_BACKGROUNDS),
});

export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

export const DEFAULT_SETTINGS: GenerationSettings = {
  titleMaxChars: 70,
  descriptionMaxChars: 200,
  keywordCount: 30,
  keywordStyle: "auto",
  includeTerms: [],
  excludeTerms: [],
  filenameAsTitle: false,
  filenameOnly: false,
  titlePrefix: "",
  titleSuffix: "",
  descriptionPrefix: "",
  descriptionSuffix: "",
  svgMode: "standard",
  pngBackground: "white",
};

/** Parse a comma- or newline-separated list of terms, dropping blanks and case-insensitive duplicates. */
export function parseTermList(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\n;]/)) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const key = t.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, SETTINGS_BOUNDS.terms.maxLength));
    if (out.length >= SETTINGS_BOUNDS.terms.maxItems) break;
  }
  return out;
}

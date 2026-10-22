import { filenameOnlyMetadata, filenameToTitle } from "./filename";
import { processKeywords } from "./keywords";
import type { MetadataResult, ModelOutput } from "./schema";
import type { GenerationSettings } from "./settings";
import { cleanInline, composeWithAffixes, truncateText } from "./text";

export const MAX_REVIEW_FLAGS = 8;
const MAX_FLAG_LENGTH = 240;
const MAX_CATEGORY_LENGTH = 40;

export interface AssetContext {
  assetId: string;
  filename: string;
  settings: GenerationSettings;
}

function cleanFlags(flags: readonly unknown[] | null | undefined): string[] {
  if (!flags) return [];
  return flags
    .filter((f): f is string => typeof f === "string")
    .map((f) => truncateText(cleanInline(f), MAX_FLAG_LENGTH))
    .filter(Boolean);
}

function finalizeFlags(flags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of flags) {
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out.slice(0, MAX_REVIEW_FLAGS);
}

function applyTextRules(title: string, description: string, settings: GenerationSettings) {
  const flags: string[] = [];
  const t = composeWithAffixes(title, settings.titlePrefix, settings.titleSuffix, settings.titleMaxChars);
  const d = composeWithAffixes(
    description,
    settings.descriptionPrefix,
    settings.descriptionSuffix,
    settings.descriptionMaxChars,
  );
  if (t.error) flags.push(`Title: ${t.error}`);
  if (d.error) flags.push(`Description: ${d.error}`);
  return { title: t.value, description: d.value, flags };
}

/** Deterministic post-processing of a schema-valid Gemini response. */
export function normalizeModelOutput(output: ModelOutput, ctx: AssetContext): MetadataResult {
  const { settings } = ctx;
  const flags: string[] = [];

  let title = cleanInline(output.title);
  if (settings.filenameAsTitle) {
    const fromName = filenameToTitle(ctx.filename);
    if (fromName) {
      title = fromName;
    } else {
      flags.push("Filename has no usable words, so the generated title was kept instead.");
    }
  }

  const text = applyTextRules(title, cleanInline(output.description), settings);
  const kw = processKeywords(output.keywords, {
    count: settings.keywordCount,
    style: settings.keywordStyle,
    includeTerms: settings.includeTerms,
    excludeTerms: settings.excludeTerms,
    inapplicableIncludeTerms: output.inapplicableIncludeTerms ?? [],
  });

  const category = output.category ? truncateText(cleanInline(output.category).toLocaleLowerCase(), MAX_CATEGORY_LENGTH) : "";

  return {
    assetId: ctx.assetId,
    filename: ctx.filename,
    title: text.title,
    description: text.description,
    keywords: kw.keywords,
    category: category || undefined,
    reviewFlags: finalizeFlags([...cleanFlags(output.reviewFlags), ...flags, ...text.flags, ...kw.flags]),
    source: "gemini",
  };
}

/** Filename-only mode result. Pure and offline: it never calls Gemini. */
export function buildFilenameOnlyResult(ctx: AssetContext): MetadataResult {
  const meta = filenameOnlyMetadata(ctx.filename, ctx.settings);
  const text = meta.title ? applyTextRules(meta.title, meta.description, ctx.settings) : { title: "", description: "", flags: [] };
  return {
    assetId: ctx.assetId,
    filename: ctx.filename,
    title: text.title,
    description: text.description,
    keywords: meta.keywords,
    category: undefined,
    reviewFlags: finalizeFlags([...meta.flags, ...text.flags]),
    source: "filename",
  };
}

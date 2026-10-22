import type { GenerationSettings } from "@/lib/metadata/settings";
import { cleanInline } from "@/lib/metadata/text";

export const SYSTEM_INSTRUCTION = `You write metadata for stock-media marketplaces (photos, illustrations, vectors and video).

Describe only what is visibly present: the main subject, action, setting, composition, lighting, colours and the concepts the asset clearly conveys.

Rules:
- Do not guess brands, logos, exact locations, landmarks you cannot verify, the identity of any person, or events. Never infer sensitive attributes (ethnicity, religion, health, sexual orientation, political views) or age beyond broad visible categories such as "child" or "adult".
- Never state or imply that the asset is AI-generated, editorial, adult, model-released, property-released, or owned by a named artist. Those are user decisions.
- Title: concise, accurate and natural; no keyword lists, no trailing period.
- Description: one or two natural, specific sentences.
- Keywords: ordered from most to least relevant. Strongest, most specific terms first. No duplicates, no near-duplicate plural/singular pairs, no keyword stuffing, no generic filler (such as "image", "photo", "stock"), no terms unrelated to the asset.
- The filename is a weak hint only. Trust the pixels over the filename when they disagree.
- reviewFlags: short notes about anything uncertain or ambiguous a human should double-check (e.g. species that is hard to tell apart, text you could not read, possible trademark or recognisable person). Leave empty when nothing is uncertain.
- Respond with JSON only, matching the provided schema.`;

function styleRule(style: GenerationSettings["keywordStyle"]): string {
  if (style === "single") return "Every keyword must be a single word.";
  if (style === "double") return "Every keyword must be a two-word phrase (exactly two words).";
  return "Use a natural mix of single words and short phrases of up to three words.";
}

export interface PromptContext {
  filename: string;
  mediaKind: "image" | "video";
  /** True when the image is an analysis-only silhouette of an SVG. */
  silhouette?: boolean;
  /** True when the image is a rasterized SVG. */
  fromSvg?: boolean;
}

/** Sanitize the filename hint so it cannot carry instructions or control characters. */
export function filenameHint(filename: string): string {
  return cleanInline(filename.replace(/[<>{}`"\\]/g, " ")).slice(0, 120);
}

export function buildUserPrompt(settings: GenerationSettings, ctx: PromptContext): string {
  const lines: string[] = [];
  const subject = ctx.mediaKind === "video" ? "video clip" : ctx.fromSvg ? "vector illustration (rendered from SVG)" : "image";
  lines.push(`Write stock metadata for the attached ${subject}.`);
  if (ctx.silhouette) {
    lines.push(
      "The image is a black silhouette of the original vector made for analysis only; colours and inner details are not visible, so describe shapes and subjects without guessing colours.",
    );
  }
  if (ctx.mediaKind === "video") {
    lines.push("Consider the whole clip: subject, action, camera movement and setting across the duration.");
  }
  lines.push(`Title: at most ${settings.titleMaxChars} characters.`);
  lines.push(`Description: at most ${settings.descriptionMaxChars} characters.`);
  lines.push(`Keywords: provide ${Math.min(settings.keywordCount + 10, 60)} candidates, best first. ${styleRule(settings.keywordStyle)}`);
  if (settings.includeTerms.length > 0) {
    lines.push(
      `The user wants these terms included when they genuinely apply: ${settings.includeTerms.map((t) => `"${filenameHint(t)}"`).join(", ")}. Put any that do not match the visible content in inapplicableIncludeTerms instead of the keywords.`,
    );
  }
  if (settings.excludeTerms.length > 0) {
    lines.push(`Do not use these terms anywhere: ${settings.excludeTerms.map((t) => `"${filenameHint(t)}"`).join(", ")}.`);
  }
  lines.push(`Filename hint (unreliable): "${filenameHint(ctx.filename)}".`);
  return lines.join("\n");
}

export function buildCorrectionPrompt(problem: string): string {
  return `Your previous reply was not valid JSON matching the required schema (${problem}). Reply again with only the corrected JSON object containing title, description, keywords, category, reviewFlags and inapplicableIncludeTerms.`;
}

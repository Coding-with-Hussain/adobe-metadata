import { containsTerm, keywordKey, MAX_KEYWORD_LENGTH } from "./keywords";
import type { GenerationSettings } from "./settings";
import { charCount } from "./text";

export type IssueSeverity = "error" | "warning";
export type MetadataField = "title" | "description" | "keywords" | "category" | "filename";

export interface ValidationIssue {
  field: MetadataField;
  severity: IssueSeverity;
  message: string;
}

export interface EditableMetadata {
  title: string;
  description: string;
  keywords: string[];
  category?: string;
}

/**
 * Validate (possibly user-edited) metadata against the generation settings.
 * Errors make a row invalid for export; warnings are shown but do not block.
 */
export function validateMetadata(meta: EditableMetadata, settings: GenerationSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const titleLen = charCount(meta.title.trim());
  const descLen = charCount(meta.description.trim());

  if (titleLen === 0) issues.push({ field: "title", severity: "error", message: "Title is empty." });
  else if (titleLen > settings.titleMaxChars)
    issues.push({
      field: "title",
      severity: "error",
      message: `Title is ${titleLen} characters; the limit is ${settings.titleMaxChars}.`,
    });

  if (descLen === 0) issues.push({ field: "description", severity: "error", message: "Description is empty." });
  else if (descLen > settings.descriptionMaxChars)
    issues.push({
      field: "description",
      severity: "error",
      message: `Description is ${descLen} characters; the limit is ${settings.descriptionMaxChars}.`,
    });

  const keys = meta.keywords.map(keywordKey);
  if (meta.keywords.length === 0) {
    issues.push({ field: "keywords", severity: "error", message: "Add at least one keyword." });
  }
  if (new Set(keys).size !== keys.length) {
    issues.push({ field: "keywords", severity: "error", message: "Keywords contain duplicates." });
  }
  if (meta.keywords.some((k) => !k.trim() || charCount(k) > MAX_KEYWORD_LENGTH || k.includes(","))) {
    issues.push({
      field: "keywords",
      severity: "error",
      message: `Keywords must be non-empty, contain no commas and be at most ${MAX_KEYWORD_LENGTH} characters.`,
    });
  }
  if (meta.keywords.length > 0 && meta.keywords.length !== settings.keywordCount) {
    issues.push({
      field: "keywords",
      severity: "warning",
      message: `${meta.keywords.length} keyword${meta.keywords.length === 1 ? "" : "s"}; your target is ${settings.keywordCount}.`,
    });
  }
  const excludedHits = settings.excludeTerms.filter((term) => meta.keywords.some((k) => containsTerm(k, term)));
  if (excludedHits.length > 0) {
    issues.push({
      field: "keywords",
      severity: "warning",
      message: `Contains excluded term${excludedHits.length > 1 ? "s" : ""}: ${excludedHits.join(", ")}.`,
    });
  }
  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

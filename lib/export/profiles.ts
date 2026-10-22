import { charCount } from "@/lib/metadata/text";
import type { ValidationIssue } from "@/lib/metadata/validate";

/** A reviewed row ready for export. `profileFields` holds explicit, per-row user input for profile-specific columns. */
export interface ExportRow {
  assetId: string;
  filename: string;
  title: string;
  description: string;
  keywords: string[];
  category?: string;
  profileFields: Record<string, string>;
}

export interface ProfileField {
  id: string;
  label: string;
  help: string;
  placeholder?: string;
}

export const KEYWORD_FORMATS = {
  semicolon: { label: "Semicolon-separated (fox; snow)", join: (k: string[]) => k.join("; ") },
  comma: { label: "Comma-separated (fox, snow)", join: (k: string[]) => k.join(", ") },
  pipe: { label: "Pipe-separated (fox | snow)", join: (k: string[]) => k.join(" | ") },
  json: { label: "JSON array ([\"fox\",\"snow\"])", join: (k: string[]) => JSON.stringify(k) },
} as const;
export type KeywordFormat = keyof typeof KEYWORD_FORMATS;

export type ProfileStatus = "stable" | "beta" | "unverified";

export interface ExportOptions {
  keywordFormat: KeywordFormat;
}

export interface ExportProfile {
  id: string;
  name: string;
  status: ProfileStatus;
  /** Disabled profiles are listed for transparency but cannot be exported. */
  enabled: boolean;
  schemaVersion: string;
  source: string;
  checkedOn: string;
  notes: string[];
  /** Whether the keyword format is fixed by the destination. */
  fixedKeywordFormat?: KeywordFormat;
  /** Extra per-row inputs the destination needs. Never auto-filled. */
  fields: ProfileField[];
  /** Maximum rows / bytes per file accepted by the destination, if documented. */
  maxRows?: number;
  maxBytes?: number;
  header: string[];
  toCells(row: ExportRow, options: ExportOptions): string[];
  validateRow(row: ExportRow): ValidationIssue[];
}

export const GENERIC_PROFILE: ExportProfile = {
  id: "generic",
  name: "Generic CSV",
  status: "stable",
  enabled: true,
  schemaVersion: "metadatagen-generic/1",
  source: "MetadataGen Gemini (this app)",
  checkedOn: "2026-10-22",
  notes: [
    "Columns: filename, title, description, keywords, category.",
    "Keywords are joined into one cell using the selected format.",
  ],
  fields: [],
  header: ["filename", "title", "description", "keywords", "category"],
  toCells(row, options) {
    return [
      row.filename,
      row.title,
      row.description,
      KEYWORD_FORMATS[options.keywordFormat].join(row.keywords),
      row.category ?? "",
    ];
  },
  validateRow(row) {
    const issues: ValidationIssue[] = [];
    if (!row.title.trim()) issues.push({ field: "title", severity: "error", message: "Title is required." });
    if (row.keywords.length === 0)
      issues.push({ field: "keywords", severity: "error", message: "At least one keyword is required." });
    return issues;
  },
};

const ADOBE_MAX_KEYWORDS = 50;
const ADOBE_TITLE_RECOMMENDED = 70;
const ADOBE_FILENAME_RECOMMENDED = 30;

export const ADOBE_STOCK_PROFILE: ExportProfile = {
  id: "adobe-stock",
  name: "Adobe Stock",
  status: "beta",
  enabled: true,
  schemaVersion: "adobe-stock-csv/2026-10 (Filename, Title, Keywords, Category, Releases)",
  source:
    "Adobe Stock contributor help: “Create CSV files for Adobe Stock” and “CSV requirements” (helpx.adobe.com/stock/contributor/manage-your-portfolio/).",
  checkedOn: "2026-10-22",
  notes: [
    "Header row matches Adobe's published sample: Filename, Title, Keywords, Category, Releases.",
    "Checked against Adobe's help pages via search excerpts; the sample file itself could not be downloaded from this build environment. Re-check before relying on it.",
    "Adobe's CSV has no description column, so descriptions are not exported.",
    "Category is Adobe's category number and Releases are exact release names from your contributor account. Both are optional and only filled from what you enter.",
    "Limits from Adobe's docs: up to 50 keywords, title recommended at 70 characters or fewer, at most 5,000 rows and 1 MB per CSV file.",
  ],
  fixedKeywordFormat: "comma",
  fields: [
    {
      id: "adobeCategory",
      label: "Adobe category #",
      help: "Optional. Number from Adobe's category list (see the Adobe Stock contributor help).",
      placeholder: "e.g. 1",
    },
    {
      id: "adobeReleases",
      label: "Releases",
      help: "Optional. Exact model/property release names as uploaded to Adobe Stock, comma-separated.",
      placeholder: "Release name",
    },
  ],
  maxRows: 5000,
  maxBytes: 1024 * 1024,
  header: ["Filename", "Title", "Keywords", "Category", "Releases"],
  toCells(row) {
    return [
      row.filename,
      row.title,
      KEYWORD_FORMATS.comma.join(row.keywords),
      (row.profileFields.adobeCategory ?? "").trim(),
      (row.profileFields.adobeReleases ?? "").trim(),
    ];
  },
  validateRow(row) {
    const issues: ValidationIssue[] = [];
    const titleLen = charCount(row.title.trim());
    if (titleLen === 0) issues.push({ field: "title", severity: "error", message: "Adobe Stock requires a title." });
    else if (titleLen > ADOBE_TITLE_RECOMMENDED)
      issues.push({
        field: "title",
        severity: "warning",
        message: `Adobe recommends titles of ${ADOBE_TITLE_RECOMMENDED} characters or fewer (this one is ${titleLen}).`,
      });
    if (row.keywords.length === 0)
      issues.push({ field: "keywords", severity: "error", message: "Adobe Stock requires keywords." });
    if (row.keywords.length > ADOBE_MAX_KEYWORDS)
      issues.push({
        field: "keywords",
        severity: "error",
        message: `Adobe Stock accepts at most ${ADOBE_MAX_KEYWORDS} keywords (this row has ${row.keywords.length}).`,
      });
    if (charCount(row.filename) > ADOBE_FILENAME_RECOMMENDED)
      issues.push({
        field: "filename",
        severity: "warning",
        message: `Adobe's CSV guide suggests filenames of ${ADOBE_FILENAME_RECOMMENDED} characters or fewer. It must match the uploaded file exactly.`,
      });
    const category = (row.profileFields.adobeCategory ?? "").trim();
    if (category && !/^[1-9]\d{0,2}$/.test(category))
      issues.push({ field: "category", severity: "error", message: "Adobe category must be a whole number." });
    return issues;
  },
};

interface UnverifiedSpec {
  id: string;
  name: string;
}

const UNVERIFIED: UnverifiedSpec[] = [
  { id: "vecteezy", name: "Vecteezy" },
  { id: "123rf", name: "123RF" },
  { id: "freepik", name: "Freepik" },
  { id: "pond5", name: "Pond5" },
  { id: "depositphotos", name: "Depositphotos" },
  { id: "canva", name: "Canva" },
  { id: "istock", name: "iStock" },
];

function unverifiedProfile(spec: UnverifiedSpec): ExportProfile {
  return {
    id: spec.id,
    name: spec.name,
    status: "unverified",
    enabled: false,
    schemaVersion: "—",
    source: "Not verified",
    checkedOn: "2026-10-22",
    notes: [
      `${spec.name}'s current contributor CSV template could not be verified from official documentation while building this version, so export is disabled rather than guessed.`,
      "Use Generic CSV and map the columns in the destination, or add a verified adapter in lib/export/profiles.ts.",
    ],
    fields: [],
    header: [],
    toCells: () => [],
    validateRow: () => [],
  };
}

export const EXPORT_PROFILES: ExportProfile[] = [GENERIC_PROFILE, ADOBE_STOCK_PROFILE, ...UNVERIFIED.map(unverifiedProfile)];

export function getProfile(id: string): ExportProfile {
  return EXPORT_PROFILES.find((p) => p.id === id) ?? GENERIC_PROFILE;
}

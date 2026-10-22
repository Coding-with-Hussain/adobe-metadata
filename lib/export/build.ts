import type { ValidationIssue } from "@/lib/metadata/validate";
import { toCsv, utf8ByteLength } from "./csv";
import type { ExportOptions, ExportProfile, ExportRow } from "./profiles";

export interface ExportCandidate {
  assetId: string;
  filename: string;
  /** Null when the asset has no metadata yet (queued, failed, cancelled, rejected). */
  row: ExportRow | null;
  /** Issues from the generation-settings validation of the current (edited) values. */
  issues: ValidationIssue[];
  /** Why there is no row, shown in the report. */
  missingReason?: string;
}

export interface RowReport {
  assetId: string;
  filename: string;
  issues: ValidationIssue[];
}

export interface ExportReport {
  profileId: string;
  valid: RowReport[];
  invalid: RowReport[];
  missing: { assetId: string; filename: string; reason: string }[];
  warningCount: number;
}

export function buildExportReport(candidates: ExportCandidate[], profile: ExportProfile): ExportReport {
  const report: ExportReport = { profileId: profile.id, valid: [], invalid: [], missing: [], warningCount: 0 };
  for (const c of candidates) {
    if (!c.row) {
      report.missing.push({ assetId: c.assetId, filename: c.filename, reason: c.missingReason ?? "No metadata yet." });
      continue;
    }
    const issues = [...c.issues, ...profile.validateRow(c.row)];
    const entry = { assetId: c.assetId, filename: c.filename, issues };
    report.warningCount += issues.filter((i) => i.severity === "warning").length;
    if (issues.some((i) => i.severity === "error")) report.invalid.push(entry);
    else report.valid.push(entry);
  }
  return report;
}

export interface BuiltCsv {
  csv: string;
  filename: string;
  rowCount: number;
  bytes: number;
  fileWarnings: string[];
}

export interface BuildOptions extends ExportOptions {
  formulaGuard: boolean;
  bom: boolean;
  now?: Date;
}

export function exportFilename(profileId: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `metadatagen-${profileId}-${y}-${m}-${d}.csv`;
}

/**
 * Build the CSV from the rows the report marked valid, in the order given.
 * Invalid and missing rows are never written; the report lists them so the
 * UI can show exactly what is left out.
 */
export function buildCsv(
  candidates: ExportCandidate[],
  report: ExportReport,
  profile: ExportProfile,
  options: BuildOptions,
): BuiltCsv {
  if (!profile.enabled) throw new Error(`Export profile "${profile.name}" is not enabled.`);
  const validIds = new Set(report.valid.map((r) => r.assetId));
  const keywordFormat = profile.fixedKeywordFormat ?? options.keywordFormat;
  const rows = candidates
    .filter((c): c is ExportCandidate & { row: ExportRow } => c.row !== null && validIds.has(c.assetId))
    .map((c) => profile.toCells(c.row, { keywordFormat }));
  const csv = toCsv(profile.header, rows, { formulaGuard: options.formulaGuard, bom: options.bom });
  const bytes = utf8ByteLength(csv);
  const fileWarnings: string[] = [];
  if (profile.maxRows && rows.length > profile.maxRows)
    fileWarnings.push(`${profile.name} accepts at most ${profile.maxRows} rows per CSV; split this batch.`);
  if (profile.maxBytes && bytes > profile.maxBytes)
    fileWarnings.push(
      `${profile.name} accepts CSV files up to ${Math.round(profile.maxBytes / 1024)} KB; this one is ${Math.ceil(bytes / 1024)} KB. Split this batch.`,
    );
  return { csv, filename: exportFilename(profile.id, options.now), rowCount: rows.length, bytes, fileWarnings };
}

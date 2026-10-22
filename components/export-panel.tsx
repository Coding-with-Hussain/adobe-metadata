"use client";

import { useId, useMemo, useState } from "react";
import { buildCsv, buildExportReport, type ExportCandidate } from "@/lib/export/build";
import { EXPORT_PROFILES, KEYWORD_FORMATS, type ExportProfile, type KeywordFormat } from "@/lib/export/profiles";
import { formatBytes } from "@/lib/config/limits";
import { AlertIcon, CheckCircleIcon, DownloadIcon, ErrorIcon, InfoIcon } from "./icons";
import { Button, Checkbox, cx, FieldLabel, inputClass, Notice, Panel } from "./ui";

export interface ExportPrefs {
  profileId: string;
  keywordFormat: KeywordFormat;
  formulaGuard: boolean;
  bom: boolean;
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  profileId: "generic",
  keywordFormat: "semicolon",
  formulaGuard: true,
  bom: false,
};

const STATUS_LABEL = { stable: "Stable", beta: "Beta", unverified: "Schema needs verification" } as const;

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({
  candidates,
  profile,
  prefs,
  onPrefs,
  onJumpTo,
}: {
  candidates: ExportCandidate[];
  profile: ExportProfile;
  prefs: ExportPrefs;
  onPrefs: (prefs: ExportPrefs) => void;
  onJumpTo: (assetId: string) => void;
}) {
  const uid = useId();
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [lastExport, setLastExport] = useState<{ filename: string; rows: number; bytes: number; warnings: string[] } | null>(null);
  const report = useMemo(() => buildExportReport(candidates, profile), [candidates, profile]);
  const partial = report.invalid.length > 0 || report.missing.length > 0;
  const canExport = profile.enabled && report.valid.length > 0 && (!partial || confirmPartial);

  const doExport = () => {
    const built = buildCsv(candidates, report, profile, {
      keywordFormat: prefs.keywordFormat,
      formulaGuard: prefs.formulaGuard,
      bom: prefs.bom,
    });
    downloadText(built.filename, built.csv);
    setLastExport({ filename: built.filename, rows: built.rowCount, bytes: built.bytes, warnings: built.fileWarnings });
  };

  return (
    <Panel id="export" title="Export CSV" description="Built in your browser from the reviewed values. Nothing is submitted to any marketplace.">
      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor={`${uid}-profile`}>Destination profile</FieldLabel>
          <select
            id={`${uid}-profile`}
            value={profile.id}
            onChange={(e) => {
              onPrefs({ ...prefs, profileId: e.target.value });
              setConfirmPartial(false);
            }}
            className={inputClass}
          >
            {EXPORT_PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.status !== "stable" ? ` — ${STATUS_LABEL[p.status]}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                profile.status === "stable" && "border-success/30 bg-success-soft text-success",
                profile.status === "beta" && "border-warning/30 bg-warning-soft text-warning",
                profile.status === "unverified" && "border-danger/30 bg-danger-soft text-danger",
              )}
            >
              {STATUS_LABEL[profile.status]}
            </span>
            {profile.enabled && <span className="font-mono text-[11px] text-ink">{profile.schemaVersion}</span>}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {profile.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">
            Source: {profile.source} · checked {profile.checkedOn}
          </p>
        </div>

        {profile.enabled && (
          <>
            <div>
              <FieldLabel htmlFor={`${uid}-kwfmt`}>Keyword cell format</FieldLabel>
              <select
                id={`${uid}-kwfmt`}
                value={profile.fixedKeywordFormat ?? prefs.keywordFormat}
                disabled={!!profile.fixedKeywordFormat}
                onChange={(e) => onPrefs({ ...prefs, keywordFormat: e.target.value as KeywordFormat })}
                className={inputClass}
              >
                {Object.entries(KEYWORD_FORMATS).map(([id, f]) => (
                  <option key={id} value={id}>
                    {f.label}
                  </option>
                ))}
              </select>
              {profile.fixedKeywordFormat && <p className="mt-1 text-[11px] text-faint">Fixed by {profile.name}.</p>}
            </div>
            <Checkbox
              id={`${uid}-guard`}
              checked={prefs.formulaGuard}
              onChange={(v) => onPrefs({ ...prefs, formulaGuard: v })}
              label="Protect against spreadsheet formulas (recommended)"
              description="Cells starting with =, +, - or @ get a leading apostrophe so Excel/Sheets cannot run them as formulas."
            />
            <Checkbox
              id={`${uid}-bom`}
              checked={prefs.bom}
              onChange={(v) => onPrefs({ ...prefs, bom: v })}
              label="Add UTF-8 BOM"
              description="Helps older Excel versions show accented characters. Leave off for marketplace uploads."
            />
          </>
        )}

        {profile.enabled && (
          <section aria-labelledby={`${uid}-report`} className="rounded-lg border border-line">
            <h3 id={`${uid}-report`} className="border-b border-line px-3 py-2 text-[13px] font-semibold text-ink">
              Pre-export check
            </h3>
            <div className="space-y-2 px-3 py-2.5 text-[13px]" aria-live="polite">
              <p className="flex items-center gap-1.5 text-success">
                <CheckCircleIcon size={14} /> {report.valid.length} row{report.valid.length === 1 ? "" : "s"} ready to export
                {report.warningCount > 0 && <span className="text-warning">· {report.warningCount} warning{report.warningCount === 1 ? "" : "s"}</span>}
              </p>
              {report.invalid.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-danger">
                    <ErrorIcon size={14} /> {report.invalid.length} row{report.invalid.length === 1 ? "" : "s"} with errors (not exported)
                  </p>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pl-5 text-[12px]">
                    {report.invalid.map((r) => (
                      <li key={r.assetId}>
                        <button type="button" onClick={() => onJumpTo(r.assetId)} className="font-medium text-ink underline decoration-dotted underline-offset-2 hover:text-accent">
                          {r.filename}
                        </button>
                        <span className="text-muted">: {r.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.missing.length > 0 && (
                <div>
                  <p className="flex items-center gap-1.5 text-warning">
                    <AlertIcon size={14} /> {report.missing.length} file{report.missing.length === 1 ? "" : "s"} without metadata (not exported)
                  </p>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-5 text-[12px] text-muted">
                    {report.missing.map((m) => (
                      <li key={m.assetId}>
                        <span className="text-ink">{m.filename}</span>: {m.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {profile.enabled && partial && report.valid.length > 0 && (
          <Checkbox
            id={`${uid}-partial`}
            checked={confirmPartial}
            onChange={setConfirmPartial}
            label={`Export only the ${report.valid.length} valid row${report.valid.length === 1 ? "" : "s"}`}
            description="The rows listed above will be left out of this file. You can fix them and export again."
          />
        )}

        {!profile.enabled ? (
          <Notice tone="warning" icon={<InfoIcon size={14} />}>
            Export to {profile.name} is disabled until its template is verified. Choose Generic CSV instead.
          </Notice>
        ) : (
          <Button variant="primary" className="w-full" onClick={doExport} disabled={!canExport}>
            <DownloadIcon size={16} />
            {report.valid.length === 0 ? "No valid rows to export" : `Download ${profile.name} (${report.valid.length} row${report.valid.length === 1 ? "" : "s"})`}
          </Button>
        )}

        {lastExport && (
          <div role="status" className="space-y-2">
            <Notice tone="success" icon={<CheckCircleIcon size={14} />}>
              Saved <span className="font-mono">{lastExport.filename}</span> · {lastExport.rows} rows · {formatBytes(lastExport.bytes)}
            </Notice>
            {lastExport.warnings.map((w, i) => (
              <Notice key={i} tone="warning" icon={<AlertIcon size={14} />}>
                {w}
              </Notice>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

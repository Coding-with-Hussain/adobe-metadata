"use client";

import { memo, useId } from "react";
import type { ExportProfile } from "@/lib/export/profiles";
import type { GenerationSettings } from "@/lib/metadata/settings";
import { charCount } from "@/lib/metadata/text";
import type { EditableMetadata, ValidationIssue } from "@/lib/metadata/validate";
import { assetIssues, displayStatus, isEdited, type Asset, type DisplayStatus } from "@/lib/queue/assets";
import { AlertIcon, CheckIcon, ErrorIcon, RefreshIcon, UndoIcon } from "./icons";
import { KeywordEditor } from "./keyword-editor";
import { StatusBadge } from "./status-badge";
import { Thumbnail } from "./thumbnail";
import { Button, cx, inputClass, Notice, Panel } from "./ui";

export interface ResultActions {
  edit: (id: string, patch: Partial<EditableMetadata>) => void;
  revert: (id: string) => void;
  acknowledge: (id: string) => void;
  regenerate: (id: string) => void;
  retry: (id: string) => void;
  setProfileField: (id: string, field: string, value: string) => void;
}

export type ResultFilter = "all" | "review" | "ready" | "failed";
type Filter = ResultFilter;
export const PAGE_SIZE = 20;

function Counter({ value, max }: { value: string; max: number }) {
  const n = charCount(value.trim());
  return (
    <span className={cx("text-[11px] tabular-nums", n > max ? "font-semibold text-danger" : n > max * 0.9 ? "text-warning" : "text-faint")}>
      {n}/{max}
    </span>
  );
}

function FieldIssues({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((i, idx) => (
        <li key={idx} className={cx("flex items-start gap-1 text-[12px]", i.severity === "error" ? "text-danger" : "text-warning")}>
          {i.severity === "error" ? <ErrorIcon size={13} className="mt-px shrink-0" /> : <AlertIcon size={13} className="mt-px shrink-0" />}
          <span>
            <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
            {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

const ResultCard = memo(function ResultCard({
  asset,
  settings,
  profile,
  canGenerate,
  actions,
}: {
  asset: Asset;
  settings: GenerationSettings;
  profile: ExportProfile;
  canGenerate: boolean;
  actions: ResultActions;
}) {
  const uid = useId();
  const status = displayStatus(asset, settings);
  const meta = asset.metadata;
  const busy = status === "queued" || status === "processing" || status === "retrying";

  if (!meta) {
    return (
      <article id={`result-${asset.id}`} className="flex scroll-mt-20 flex-col gap-3 p-4 sm:flex-row sm:items-center" aria-label={asset.name}>
        <Thumbnail asset={asset} size={64} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-ink">{asset.name}</h3>
          <p className="mt-1 text-[13px] text-danger">{asset.error?.message ?? "No metadata."}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} stage={asset.stage} attempt={asset.attempt} />
          {status === "failed" && (
            <Button size="sm" onClick={() => actions.retry(asset.id)} disabled={!canGenerate}>
              <RefreshIcon size={14} />
              Retry
            </Button>
          )}
        </div>
      </article>
    );
  }

  const issues = assetIssues(asset, settings);
  const profileIssues = profile.enabled ? profile.validateRow({ ...meta, assetId: asset.id, filename: asset.name, profileFields: asset.profileFields }) : [];
  const byField = (f: ValidationIssue["field"]) => [...issues, ...profileIssues].filter((i) => i.field === f);
  const edited = isEdited(asset);

  return (
    <article id={`result-${asset.id}`} className="scroll-mt-20 p-4" aria-label={asset.name}>
      <div className="flex flex-wrap items-start gap-3">
        <Thumbnail asset={asset} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-[14px] font-semibold text-ink" title={asset.name}>
              {asset.name}
            </h3>
            <StatusBadge status={status} stage={asset.stage} attempt={asset.attempt} />
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
              {asset.source === "filename" ? "From filename" : "Gemini"}
            </span>
            {edited && <span className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Edited</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !canGenerate}
              onClick={() => {
                if (!edited || window.confirm(`Regenerate “${asset.name}”? Your edits to this file will be replaced when the new result arrives.`)) {
                  actions.regenerate(asset.id);
                }
              }}
            >
              <RefreshIcon size={14} />
              {busy ? "Regenerating…" : "Regenerate"}
            </Button>
            {edited && (
              <Button size="sm" variant="ghost" onClick={() => actions.revert(asset.id)} disabled={busy}>
                <UndoIcon size={14} />
                Revert edits
              </Button>
            )}
            {asset.reviewFlags.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => actions.acknowledge(asset.id)}>
                <CheckIcon size={14} />
                Mark reviewed
              </Button>
            )}
          </div>
        </div>
      </div>

      {asset.error && (
        <Notice tone="danger" className="mt-3" icon={<ErrorIcon size={14} />} role="alert">
          Regenerate failed: {asset.error.message} The previous metadata is kept.
        </Notice>
      )}
      {asset.reviewFlags.length > 0 && (
        <Notice tone="warning" className="mt-3" icon={<AlertIcon size={14} />} title="Please review">
          <ul className="list-disc space-y-0.5 pl-4">
            {asset.reviewFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="mt-4 grid gap-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={`${uid}-title`} className="text-[12px] font-medium text-muted">
              Title
            </label>
            <Counter value={meta.title} max={settings.titleMaxChars} />
          </div>
          <input
            id={`${uid}-title`}
            type="text"
            value={meta.title}
            onChange={(e) => actions.edit(asset.id, { title: e.target.value })}
            aria-invalid={byField("title").some((i) => i.severity === "error")}
            className={cx(inputClass, byField("title").some((i) => i.severity === "error") && "border-danger")}
          />
          <FieldIssues issues={byField("title")} />
        </div>
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={`${uid}-desc`} className="text-[12px] font-medium text-muted">
              Description
            </label>
            <Counter value={meta.description} max={settings.descriptionMaxChars} />
          </div>
          <textarea
            id={`${uid}-desc`}
            rows={2}
            value={meta.description}
            onChange={(e) => actions.edit(asset.id, { description: e.target.value })}
            aria-invalid={byField("description").some((i) => i.severity === "error")}
            className={cx(inputClass, "resize-y", byField("description").some((i) => i.severity === "error") && "border-danger")}
          />
          <FieldIssues issues={byField("description")} />
        </div>
        <div>
          <KeywordEditor
            label="Keywords"
            keywords={meta.keywords}
            target={settings.keywordCount}
            invalid={byField("keywords").some((i) => i.severity === "error")}
            onChange={(keywords) => actions.edit(asset.id, { keywords })}
          />
          <FieldIssues issues={byField("keywords")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-cat`} className="mb-1.5 block text-[12px] font-medium text-muted">
              Category (suggested, optional)
            </label>
            <input
              id={`${uid}-cat`}
              type="text"
              value={meta.category ?? ""}
              onChange={(e) => actions.edit(asset.id, { category: e.target.value || undefined })}
              className={inputClass}
            />
          </div>
          {profile.enabled &&
            profile.fields.map((f) => (
              <div key={f.id}>
                <label htmlFor={`${uid}-${f.id}`} className="mb-1.5 block text-[12px] font-medium text-muted">
                  {f.label} <span className="font-normal text-faint">({profile.name})</span>
                </label>
                <input
                  id={`${uid}-${f.id}`}
                  type="text"
                  value={asset.profileFields[f.id] ?? ""}
                  placeholder={f.placeholder}
                  aria-describedby={`${uid}-${f.id}-help`}
                  onChange={(e) => actions.setProfileField(asset.id, f.id, e.target.value)}
                  className={inputClass}
                />
                <p id={`${uid}-${f.id}-help`} className="mt-1 text-[11px] text-faint">
                  {f.help}
                </p>
              </div>
            ))}
        </div>
        <FieldIssues issues={[...byField("category"), ...byField("filename")]} />
      </div>
    </article>
  );
});

export function ResultsPanel({
  assets,
  settings,
  profile,
  canGenerate,
  actions,
  filter,
  page,
  onFilter,
  onPage,
}: {
  assets: Asset[];
  settings: GenerationSettings;
  profile: ExportProfile;
  canGenerate: boolean;
  actions: ResultActions;
  filter: Filter;
  page: number;
  onFilter: (f: Filter) => void;
  onPage: (page: number) => void;
}) {

  const withStatus = assets
    .filter((a) => a.metadata || a.status === "failed")
    .map((a) => ({ a, s: displayStatus(a, settings) }));
  const matches = (s: DisplayStatus, f: Filter) =>
    f === "all" || (f === "review" && s === "needs_review") || (f === "ready" && s === "ready") || (f === "failed" && s === "failed");
  const counts: Record<Filter, number> = {
    all: withStatus.length,
    review: withStatus.filter((x) => x.s === "needs_review").length,
    ready: withStatus.filter((x) => x.s === "ready").length,
    failed: withStatus.filter((x) => x.s === "failed").length,
  };
  const visible = withStatus.filter((x) => matches(x.s, filter));
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = visible.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  if (withStatus.length === 0) return null;

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "review", label: "Needs review" },
    { id: "ready", label: "Ready" },
    { id: "failed", label: "Failed" },
  ];

  return (
    <Panel
      id="results"
      title="Review and edit"
      description="Every field is editable. Keyword order matters — the first keywords are the strongest."
    >
      <div role="group" aria-label="Filter results" className="-mt-1 mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={filter === t.id}
            onClick={() => onFilter(t.id)}
            className={cx(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              filter === t.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink",
            )}
          >
            {t.label} <span className="tabular-nums">({counts[t.id]})</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">Nothing in this view.</p>
      ) : (
        <div className="-mx-4 divide-y divide-line border-y border-line sm:-mx-5">
          {slice.map(({ a }) => (
            <ResultCard key={a.id} asset={a} settings={settings} profile={profile} canGenerate={canGenerate} actions={actions} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav aria-label="Results pages" className="mt-3 flex items-center justify-between gap-2 text-[13px]">
          <Button size="sm" onClick={() => onPage(current - 1)} disabled={current === 0}>
            Previous
          </Button>
          <span className="text-muted">
            Page {current + 1} of {pages} · {visible.length} files
          </span>
          <Button size="sm" onClick={() => onPage(current + 1)} disabled={current >= pages - 1}>
            Next
          </Button>
        </nav>
      )}
    </Panel>
  );
}

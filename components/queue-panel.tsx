"use client";

import { formatBytes, formatDuration } from "@/lib/config/limits";
import type { GenerationSettings } from "@/lib/metadata/settings";
import { displayStatus, type Asset, type BatchCounts } from "@/lib/queue/assets";
import { RefreshIcon, SparkleIcon, StopIcon, TrashIcon, XIcon } from "./icons";
import { StatusBadge } from "./status-badge";
import { Thumbnail } from "./thumbnail";
import { Button, IconButton, Panel, cx } from "./ui";

export interface QueueActions {
  generate: () => void;
  cancelAll: () => void;
  retryFailed: () => void;
  clearAll: () => void;
  remove: (id: string) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
}

function ProgressBar({ counts }: { counts: BatchCounts }) {
  const workable = counts.total - counts.rejected;
  const done = counts.ready + counts.needsReview + counts.failed + counts.cancelled;
  const pct = workable > 0 ? Math.round((done / workable) * 100) : 0;
  const segments = [
    { n: counts.ready, cls: "bg-success" },
    { n: counts.needsReview, cls: "bg-warning" },
    { n: counts.failed, cls: "bg-danger" },
    { n: counts.cancelled, cls: "bg-faint" },
    { n: counts.processing, cls: "bg-info animate-pulse" },
  ];
  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-label="Batch progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${done} of ${workable} files finished`}
      >
        {workable > 0 &&
          segments.map((s, i) =>
            s.n > 0 ? <span key={i} className={cx("h-full", s.cls)} style={{ width: `${(s.n / workable) * 100}%` }} /> : null,
          )}
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {[
          ["Files", counts.total],
          ["Not started", counts.idle],
          ["Queued", counts.queued],
          ["In progress", counts.processing],
          ["Ready", counts.ready],
          ["Needs review", counts.needsReview],
          ["Failed", counts.failed],
          ["Cancelled", counts.cancelled],
          ["Rejected", counts.rejected],
        ]
          .filter(([label, n]) => n !== 0 || label === "Files")
          .map(([label, n]) => (
            <div key={label} className="flex gap-1">
              <dt>{label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{n}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

export function QueuePanel({
  assets,
  counts,
  settings,
  actions,
  canGenerate,
  generateBlockedReason,
  busy,
}: {
  assets: Asset[];
  counts: BatchCounts;
  settings: GenerationSettings;
  actions: QueueActions;
  canGenerate: boolean;
  generateBlockedReason: string | null;
  busy: boolean;
}) {
  const startable = counts.idle + counts.cancelled;
  return (
    <Panel
      id="queue"
      title="Batch queue"
      description="Each file is processed on its own, so one failure never affects the rest."
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={actions.clearAll} disabled={assets.length === 0}>
            <TrashIcon size={14} />
            Clear all
          </Button>
          {counts.failed > 0 && (
            <Button variant="secondary" size="sm" onClick={actions.retryFailed} disabled={!canGenerate}>
              <RefreshIcon size={14} />
              Retry failed ({counts.failed})
            </Button>
          )}
          {busy && (
            <Button variant="secondary" size="sm" onClick={actions.cancelAll}>
              <StopIcon size={14} />
              Cancel
            </Button>
          )}
        </>
      }
    >
      <ProgressBar counts={counts} />

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] leading-snug text-muted">
          {settings.filenameOnly ? (
            <>Filename-only mode is on: nothing is sent to Gemini; metadata comes from filenames.</>
          ) : (
            <>
              Clicking Generate sends each file (or an analysis-only preview), its filename and your settings to{" "}
              <strong className="text-ink">Google Gemini</strong>. Nothing is uploaded to any marketplace.
            </>
          )}
          {generateBlockedReason && <span className="mt-1 block font-medium text-danger">{generateBlockedReason}</span>}
        </p>
        <Button variant="primary" onClick={actions.generate} disabled={!canGenerate || startable === 0}>
          <SparkleIcon size={16} />
          {startable > 0 ? `Generate ${startable} file${startable === 1 ? "" : "s"}` : "Generate"}
        </Button>
      </div>

      <ul className="mt-4 max-h-[420px] divide-y divide-line overflow-y-auto rounded-lg border border-line" aria-label="Files in this batch">
        {assets.map((a) => {
          const status = displayStatus(a, settings);
          const active = status === "queued" || status === "processing" || status === "retrying";
          const detail = a.rejectionReason ?? (status === "failed" || (a.error && status !== "retrying") ? a.error?.message : undefined);
          return (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
              <Thumbnail asset={a} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink" title={a.name}>
                  {a.name}
                </p>
                <p className="text-[12px] text-muted">
                  {a.formatLabel} · {formatBytes(a.size)}
                  {a.durationSec !== null && ` · ${formatDuration(a.durationSec)}`}
                </p>
                {/* Only one of the two badges is displayed (and announced) at a time. */}
                <span className="mt-1 block sm:hidden">
                  <StatusBadge status={status} stage={a.stage} attempt={a.attempt} />
                </span>
                {detail && (
                  <p className={cx("mt-0.5 text-[12px] leading-snug", status === "rejected" || status === "failed" ? "text-danger" : "text-warning")}>
                    {status === "ready" || status === "needs_review" ? `Regenerate failed: ${detail}` : detail}
                    {status === "failed" && a.error?.retryable && ` Gave up after ${a.attempt} attempt${a.attempt === 1 ? "" : "s"}; use Retry to try again.`}
                  </p>
                )}
                {status === "retrying" && a.error && (
                  <p className="mt-0.5 text-[12px] text-warning">{a.error.message} Retrying automatically…</p>
                )}
                {status === "idle" && a.reviewFlags.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-muted">{a.reviewFlags[0]}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="mr-1 hidden sm:block">
                  <StatusBadge status={status} stage={a.stage} attempt={a.attempt} />
                </span>
                {active && (
                  <IconButton label={`Cancel ${a.name}`} onClick={() => actions.cancel(a.id)}>
                    <StopIcon size={15} />
                  </IconButton>
                )}
                {status === "failed" && (
                  <IconButton label={`Retry ${a.name}`} onClick={() => actions.retry(a.id)} disabled={!canGenerate}>
                    <RefreshIcon size={15} />
                  </IconButton>
                )}
                <IconButton label={`Remove ${a.name}`} onClick={() => actions.remove(a.id)}>
                  <XIcon size={15} />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

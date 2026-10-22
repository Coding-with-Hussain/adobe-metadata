"use client";

import { useEffect, useRef } from "react";
import { formatBytes, formatDuration, type AppLimits } from "@/lib/config/limits";
import { AlertIcon, CheckCircleIcon, ErrorIcon, HelpIcon, LoaderIcon, RefreshIcon, SparkleIcon, XIcon } from "./icons";
import { Button, cx, IconButton } from "./ui";

export type ConnectionState =
  | { status: "checking"; message: string; model?: string }
  | { status: "connected"; message: string; model: string }
  | { status: "not_configured"; message: string; model?: string }
  | { status: "error"; message: string; model?: string; code?: string };

export function ConnectionPill({ state, onTest }: { state: ConnectionState; onTest: () => void }) {
  const tone = {
    checking: "border-line text-muted",
    connected: "border-success/30 bg-success-soft text-success",
    not_configured: "border-warning/30 bg-warning-soft text-warning",
    error: "border-danger/30 bg-danger-soft text-danger",
  }[state.status];
  const icon = {
    checking: <LoaderIcon size={13} />,
    connected: <CheckCircleIcon size={13} />,
    not_configured: <AlertIcon size={13} />,
    error: <ErrorIcon size={13} />,
  }[state.status];
  const label = {
    checking: "Checking Gemini…",
    connected: "Connected",
    not_configured: "Not configured",
    error: "Connection error",
  }[state.status];
  return (
    <div className="flex items-center gap-1.5">
      <span
        role="status"
        title={state.message}
        className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium", tone)}
      >
        {icon}
        <span>{label}</span>
        {state.status === "connected" && <span className="hidden font-normal opacity-80 md:inline">· {state.model}</span>}
      </span>
      <Button size="sm" variant="ghost" onClick={onTest} disabled={state.status === "checking"} aria-label="Test Gemini connection">
        <RefreshIcon size={13} />
        <span className="hidden sm:inline">Test</span>
      </Button>
    </div>
  );
}

export function TopBar({ connection, onTest, onHelp }: { connection: ConnectionState; onTest: () => void; onHelp: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
            <SparkleIcon size={16} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold text-ink">MetadataGen Gemini</p>
            <p className="hidden text-[11px] text-muted sm:block">Stock metadata, powered by Google Gemini</p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <ConnectionPill state={connection} onTest={onTest} />
          <Button size="sm" variant="ghost" onClick={onHelp}>
            <HelpIcon size={15} />
            <span className="hidden sm:inline">Help &amp; privacy</span>
            <span className="sr-only sm:hidden">Help and privacy</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function HelpDialog({
  open,
  onClose,
  limits,
  connection,
}: {
  open: boolean;
  onClose: () => void;
  limits: AppLimits;
  connection: ConnectionState;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="help-title"
      className="m-auto w-[min(680px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id="help-title" className="text-[16px] font-semibold">
          Help &amp; privacy
        </h2>
        <IconButton label="Close help" onClick={onClose}>
          <XIcon size={16} />
        </IconButton>
      </div>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-muted">
        <section>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">What is sent to Google</h3>
          <p>
            Nothing leaves your browser until you click <strong className="text-ink">Generate</strong>. Then, for each file, this
            app&apos;s server sends Google Gemini the media (or an analysis-only preview: SVGs are rendered to PNG, transparent PNGs
            can be placed on a background, very large images are downscaled), the filename as a hint, and your generation settings.
            Videos larger than {formatBytes(limits.inlineVideoMaxBytes)} are uploaded with the Gemini Files API and deleted right
            after analysis; Google also deletes such files automatically after 48 hours. How Google retains or uses API data is
            governed by the Gemini API terms for the operator&apos;s account — this app cannot change that.
          </p>
          <p className="mt-2">
            This app does not store your media or results on its server. Everything you see lives in this tab&apos;s memory and is
            gone when you close it, so export your CSV first. Generation settings are remembered for this browser session only.
          </p>
        </section>
        <section>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">Gemini connection</h3>
          <p>
            The Gemini API key is configured by whoever runs this app, as the <code className="font-mono text-ink">GEMINI_API_KEY</code>{" "}
            environment variable on the server. It is never sent to your browser. The model is set with{" "}
            <code className="font-mono text-ink">GEMINI_MODEL</code>
            {connection.model ? (
              <>
                {" "}
                (currently <code className="font-mono text-ink">{connection.model}</code>)
              </>
            ) : null}
            . Use <strong className="text-ink">Test</strong> in the top bar to check the key and model.
          </p>
          <p className="mt-2 text-ink">Status: {connection.message}</p>
        </section>
        <section>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">Filename modes</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong className="text-ink">Use filename as title</strong>: the title is the cleaned filename (camera prefixes and
              numbers removed); Gemini still writes the description and keywords from the media.
            </li>
            <li>
              <strong className="text-ink">Filename-only</strong>: no AI and no upload. Metadata is built from filename words only,
              so check every row. This mode takes precedence when both are on.
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">Limits</h3>
          <p>
            Images up to {formatBytes(limits.maxImageBytes)}, SVG up to {formatBytes(limits.maxSvgBytes)}, video up to{" "}
            {formatBytes(limits.maxVideoBytes)} and {formatDuration(limits.maxVideoSeconds)}, {limits.maxBatchFiles} files per batch,{" "}
            {limits.clientConcurrency} files processed at a time. Transient errors (rate limits, timeouts, server hiccups) are retried
            automatically with backoff; permanent errors are not.
          </p>
        </section>
        <section>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">What this app does not do</h3>
          <p>
            It does not upload or submit anything to stock marketplaces, does not decide whether an asset is AI-generated, editorial or
            released, and cannot guarantee acceptance, ranking or sales. Review every row before you use it.
          </p>
        </section>
      </div>
    </dialog>
  );
}

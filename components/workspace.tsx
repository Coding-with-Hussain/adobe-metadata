"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DEFAULT_LIMITS, findFormatByExtension, formatDuration, type AppLimits } from "@/lib/config/limits";
import type { ExportCandidate } from "@/lib/export/build";
import { getProfile } from "@/lib/export/profiles";
import { prepareAnalysisPayload, readVideoDuration } from "@/lib/media/derive";
import { fingerprintFile, validateSelectedFile } from "@/lib/media/validate-file";
import { DEFAULT_SETTINGS, generationSettingsSchema, type GenerationSettings } from "@/lib/metadata/settings";
import type { MetadataResult } from "@/lib/metadata/schema";
import { validateMetadata, type EditableMetadata } from "@/lib/metadata/validate";
import { assetsReducer, countAssets, createAsset, type Asset, type ProcessingStage } from "@/lib/queue/assets";
import { ClientError, processAsset } from "@/lib/queue/process";
import { BatchRunner, GLOBAL_ERROR_CODES } from "@/lib/queue/runner";
import { DropZone } from "./drop-zone";
import { DEFAULT_EXPORT_PREFS, ExportPanel, type ExportPrefs } from "./export-panel";
import { AlertIcon, InfoIcon, WifiOffIcon } from "./icons";
import { QueuePanel } from "./queue-panel";
import { PAGE_SIZE, ResultsPanel, type ResultFilter } from "./results-panel";
import { SettingsPanel } from "./settings-panel";
import { HelpDialog, TopBar, type ConnectionState } from "./top-bar";
import { Button, Notice } from "./ui";

const SETTINGS_KEY = "metadatagen.settings.v1";
const EXPORT_KEY = "metadatagen.export.v1";
const BLOCKING_CODES = new Set(["not_configured", "unauthorized", "model_unavailable"]);

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readSession<T>(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this page only.
  }
}

function missingReason(a: Asset): string {
  switch (a.status) {
    case "rejected":
      return `Rejected: ${a.rejectionReason ?? "unsupported file"}`;
    case "idle":
      return "Not generated yet.";
    case "queued":
    case "processing":
    case "retrying":
      return "Still processing.";
    case "failed":
      return `Failed: ${a.error?.message ?? "unknown error"}`;
    case "cancelled":
      return "Cancelled before metadata was generated.";
    default:
      return "No metadata.";
  }
}

export function Workspace() {
  const [assets, dispatch] = useReducer(assetsReducer, []);
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_SETTINGS);
  const [prefs, setPrefs] = useState<ExportPrefs>(DEFAULT_EXPORT_PREFS);
  const [limits, setLimits] = useState<AppLimits>(DEFAULT_LIMITS);
  const [connection, setConnection] = useState<ConnectionState>({ status: "checking", message: "Checking server configuration…" });
  const [paused, setPaused] = useState<{ reason: string; message: string } | null>(null);
  const [online, setOnline] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [adding, setAdding] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [page, setPage] = useState(0);

  const assetsRef = useRef(assets);
  const settingsRef = useRef(settings);
  const limitsRef = useRef(limits);
  const runnerRef = useRef<BatchRunner<MetadataResult, ProcessingStage> | null>(null);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    limitsRef.current = limits;
    runnerRef.current?.setConcurrency(limits.clientConcurrency);
  }, [limits]);

  // Restore settings and export preferences for this browser session.
  useEffect(() => {
    const s = generationSettingsSchema.safeParse(readSession(SETTINGS_KEY));
    const p = readSession<ExportPrefs>(EXPORT_KEY) as Partial<ExportPrefs> | null;
    queueMicrotask(() => {
      if (s.success) setSettings(s.data);
      if (p && typeof p === "object") setPrefs({ ...DEFAULT_EXPORT_PREFS, ...p });
    });
  }, []);

  const updateSetting = useCallback(<K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      writeSession(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  const updatePrefs = useCallback((next: ExportPrefs) => {
    setPrefs(next);
    writeSession(EXPORT_KEY, next);
  }, []);

  // Batch runner.
  useEffect(() => {
    const runner = new BatchRunner<MetadataResult, ProcessingStage>(
      {
        execute: async (id, ctx) => {
          const a = assetsRef.current.find((x) => x.id === id);
          if (!a || !a.kind) throw new ClientError("invalid_input", "This file is no longer in the batch.", false);
          return processAsset(
            {
              asset: { id: a.id, name: a.name, file: a.file, kind: a.kind, mimeType: a.mimeType },
              settings: settingsRef.current,
              limits: limitsRef.current,
              signal: ctx.signal,
              onStage: ctx.onStage,
            },
            { fetch: (...args) => fetch(...args), prepare: prepareAnalysisPayload },
          );
        },
        onStart: (id, runId) => dispatch({ type: "start", id, runId }),
        onStage: (id, runId, stage) => dispatch({ type: "stage", id, runId, stage }),
        onRetry: (id, runId, attempt, error) => dispatch({ type: "retry", id, runId, attempt, error }),
        onSuccess: (id, runId, result) => dispatch({ type: "success", id, runId, result }),
        onFailure: (id, runId, error) => dispatch({ type: "failure", id, runId, error }),
        onCancel: (id) => dispatch({ type: "cancel", id }),
        onPause: (reason, error) => {
          setPaused({
            reason,
            message:
              reason === "offline"
                ? "You are offline. Queued files will wait; nothing is lost."
                : (error?.message ?? "Generation is paused."),
          });
          if (error && BLOCKING_CODES.has(error.code)) {
            setConnection((c) => ({ status: "error", message: error.message, model: c.model, code: error.code }));
          }
        },
      },
      { concurrency: limitsRef.current.clientConcurrency, maxAttempts: 4, baseDelayMs: 1500, maxDelayMs: 20_000 },
    );
    runnerRef.current = runner;
    return () => {
      runner.cancelAll();
      runnerRef.current = null;
    };
  }, []);

  // Online/offline handling: stop scheduling while offline, resume on request.
  useEffect(() => {
    const goOffline = () => {
      setOnline(false);
      runnerRef.current?.pause("offline");
    };
    const goOnline = () => setOnline(true);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (!navigator.onLine) queueMicrotask(goOffline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Release previews when the page goes away.
  useEffect(() => {
    const revokeAll = () => assetsRef.current.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    window.addEventListener("pagehide", revokeAll);
    return () => {
      window.removeEventListener("pagehide", revokeAll);
      revokeAll();
    };
  }, []);

  // Warn before leaving with unexported results.
  const hasResults = assets.some((a) => a.metadata);
  useEffect(() => {
    if (!hasResults) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasResults]);

  const testConnection = useCallback(async () => {
    setConnection((c) => ({ status: "checking", message: "Testing the Gemini connection…", model: c.model }));
    try {
      const res = await fetch("/api/gemini/test", { method: "POST", cache: "no-store" });
      const body = (await res.json()) as { status: string; message: string; model: string; code?: string };
      if (body.status === "connected") setConnection({ status: "connected", message: body.message, model: body.model });
      else if (body.status === "not_configured") setConnection({ status: "not_configured", message: body.message, model: body.model });
      else setConnection({ status: "error", message: body.message, model: body.model, code: body.code });
    } catch {
      setConnection({ status: "error", message: "Could not reach this app's server.", code: "network" });
    }
  }, []);

  // Load server limits and configuration, then test the connection once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const body = (await res.json()) as {
          gemini: { configured: boolean; model: string; modelError: string | null };
          limits: AppLimits;
        };
        if (cancelled) return;
        setLimits(body.limits);
        if (!body.gemini.configured) {
          setConnection({
            status: "not_configured",
            model: body.gemini.model,
            message: "No Gemini API key is configured on the server.",
          });
        } else if (body.gemini.modelError) {
          setConnection({ status: "error", model: body.gemini.model, message: body.gemini.modelError, code: "model_unavailable" });
        } else {
          await testConnection();
        }
      } catch {
        if (!cancelled) setConnection({ status: "error", message: "Could not reach this app's server.", code: "network" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [testConnection]);

  const addFiles = useCallback(async (files: File[]) => {
    const lim = limitsRef.current;
    setAdding((n) => n + files.length);
    const known = new Map<string, string>();
    for (const a of assetsRef.current) if (a.fingerprint && a.status !== "rejected") known.set(a.fingerprint, a.name);
    let accepted = assetsRef.current.filter((a) => a.status !== "rejected").length;
    const created: Asset[] = [];
    let rejected = 0;
    const reject = (file: File, reason: string) => {
      rejected++;
      created.push(
        createAsset({
          id: newId(),
          file,
          format: findFormatByExtension(file.name) ?? null,
          previewUrl: null,
          durationSec: null,
          fingerprint: null,
          rejectionReason: reason,
        }),
      );
    };

    for (const file of files) {
      if (accepted >= lim.maxBatchFiles) {
        reject(file, `The batch limit of ${lim.maxBatchFiles} files is reached. Remove files or export and clear first.`);
        continue;
      }
      const check = await validateSelectedFile(file, lim);
      if (!check.ok) {
        reject(file, check.reason);
        continue;
      }
      const fp = await fingerprintFile(file).catch(() => `${file.name}:${file.size}:${file.lastModified}`);
      const dupOf = known.get(fp);
      if (dupOf) {
        reject(file, `Duplicate of “${dupOf}”, which is already in this batch.`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      let durationSec: number | null = null;
      let warning: string | undefined;
      if (check.format.kind === "video") {
        durationSec = await readVideoDuration(previewUrl);
        if (durationSec === null) {
          warning = "This browser could not read the video's duration, so only the size limit was checked.";
        } else if (durationSec > lim.maxVideoSeconds) {
          URL.revokeObjectURL(previewUrl);
          reject(file, `${formatDuration(durationSec)} is longer than the ${formatDuration(lim.maxVideoSeconds)} limit.`);
          continue;
        }
      }
      known.set(fp, file.name);
      accepted++;
      created.push(createAsset({ id: newId(), file, format: check.format, previewUrl, durationSec, fingerprint: fp, warning }));
    }
    dispatch({ type: "add", assets: created });
    setAdding((n) => n - files.length);
    const ok = created.length - rejected;
    setNotice(
      `${ok} file${ok === 1 ? "" : "s"} added${rejected ? `, ${rejected} rejected — see the queue for reasons` : ""}.`,
    );
  }, []);

  const start = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    dispatch({ type: "queue", ids });
    runnerRef.current?.enqueue(ids);
  }, []);

  const cancel = useCallback((id: string) => {
    runnerRef.current?.cancel(id);
    dispatch({ type: "cancel", id });
  }, []);

  const remove = useCallback((id: string) => {
    runnerRef.current?.cancel(id);
    const a = assetsRef.current.find((x) => x.id === id);
    if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
    dispatch({ type: "remove", id });
  }, []);

  const clearAll = useCallback(() => {
    const withResults = assetsRef.current.filter((a) => a.metadata).length;
    if (withResults > 0 && !window.confirm(`Remove all files and ${withResults} generated result${withResults === 1 ? "" : "s"}? Export first if you need them.`)) {
      return;
    }
    runnerRef.current?.cancelAll();
    assetsRef.current.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl));
    dispatch({ type: "clear" });
    setNotice("Batch cleared.");
  }, []);

  const resume = useCallback(() => {
    setPaused(null);
    runnerRef.current?.resume();
  }, []);

  const counts = useMemo(() => countAssets(assets, settings), [assets, settings]);
  const profile = getProfile(prefs.profileId);
  const busy = counts.queued + counts.processing > 0;

  const blockedReason: string | null = settings.filenameOnly
    ? null
    : connection.status === "not_configured"
      ? "Gemini is not configured on the server. Turn on filename-only mode or configure GEMINI_API_KEY."
      : connection.status === "error" && connection.code && BLOCKING_CODES.has(connection.code)
        ? connection.message
        : paused && GLOBAL_ERROR_CODES.has(paused.reason as never)
          ? `Generation paused: ${paused.message}`
          : null;
  const canGenerate = blockedReason === null && adding === 0;

  const queueActions = useMemo(
    () => ({
      generate: () => start(assetsRef.current.filter((a) => a.status === "idle" || a.status === "cancelled").map((a) => a.id)),
      cancelAll: () => {
        runnerRef.current?.cancelAll();
        assetsRef.current.forEach((a) => dispatch({ type: "cancel", id: a.id }));
      },
      retryFailed: () => start(assetsRef.current.filter((a) => a.status === "failed").map((a) => a.id)),
      clearAll,
      remove,
      cancel,
      retry: (id: string) => start([id]),
    }),
    [start, clearAll, remove, cancel],
  );

  const resultActions = useMemo(
    () => ({
      edit: (id: string, patch: Partial<EditableMetadata>) => dispatch({ type: "edit", id, patch }),
      revert: (id: string) => dispatch({ type: "revert", id }),
      acknowledge: (id: string) => dispatch({ type: "acknowledge", id }),
      regenerate: (id: string) => start([id]),
      retry: (id: string) => start([id]),
      setProfileField: (id: string, field: string, value: string) => dispatch({ type: "profileField", id, field, value }),
    }),
    [start],
  );

  const candidates: ExportCandidate[] = useMemo(
    () =>
      assets.map((a) => {
        if (!a.metadata) return { assetId: a.id, filename: a.name, row: null, issues: [], missingReason: missingReason(a) };
        const issues = validateMetadata(a.metadata, settings);
        if (a.reviewFlags.length > 0) {
          issues.push({ field: "title", severity: "warning", message: "Review notes have not been marked as reviewed." });
        }
        return {
          assetId: a.id,
          filename: a.name,
          issues,
          row: {
            assetId: a.id,
            filename: a.name,
            title: a.metadata.title.trim(),
            description: a.metadata.description.trim(),
            keywords: a.metadata.keywords,
            category: a.metadata.category?.trim() || undefined,
            profileFields: a.profileFields,
          },
        };
      }),
    [assets, settings],
  );

  const jumpTo = useCallback(
    (assetId: string) => {
      const list = assetsRef.current.filter((a) => a.metadata || a.status === "failed");
      const idx = list.findIndex((a) => a.id === assetId);
      if (idx < 0) return;
      setFilter("all");
      setPage(Math.floor(idx / PAGE_SIZE));
      setTimeout(() => {
        const el = document.getElementById(`result-${assetId}`);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        el?.querySelector<HTMLInputElement>("input, textarea")?.focus({ preventScroll: true });
      }, 60);
    },
    [],
  );

  const liveSummary =
    counts.total === 0
      ? ""
      : `${counts.processing + counts.queued} in progress, ${counts.ready} ready, ${counts.needsReview} need review, ${counts.failed} failed.`;
  const reviewable = assets.some((a) => a.metadata || a.status === "failed");

  return (
    <>
      <TopBar connection={connection} onTest={testConnection} onHelp={() => setHelpOpen(true)} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-6 sm:px-6">
        <div className="mb-6 max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">Stock metadata for whole batches</h1>
          <p className="mt-1.5 text-[15px] text-muted">
            Add photos, vectors or clips, let Gemini draft titles, descriptions and ranked keywords, review every field, then export a
            CSV for your marketplace.
          </p>
        </div>

        <div className="mb-6 space-y-3 empty:hidden">
          {connection.status === "not_configured" && !settings.filenameOnly && (
            <Notice tone="warning" icon={<AlertIcon size={15} />} title="Gemini is not configured on this server">
              Ask the operator to set <code className="font-mono">GEMINI_API_KEY</code> (and optionally{" "}
              <code className="font-mono">GEMINI_MODEL</code>) in the server environment, e.g. in <code className="font-mono">.env.local</code>, then restart
              the app. You can still use <button type="button" className="font-medium underline" onClick={() => updateSetting("filenameOnly", true)}>filename-only mode</button>, which does not use Gemini.
            </Notice>
          )}
          {connection.status === "error" && connection.code && BLOCKING_CODES.has(connection.code) && (
            <Notice tone="danger" icon={<AlertIcon size={15} />} title="Gemini connection problem" role="alert">
              {connection.message}
            </Notice>
          )}
          {!online && (
            <Notice tone="warning" icon={<WifiOffIcon size={15} />} title="You are offline" role="alert">
              New requests are paused. Files and results stay in this tab.
            </Notice>
          )}
          {paused && online && (
            <Notice tone={paused.reason === "offline" ? "info" : "danger"} icon={<InfoIcon size={15} />} title={paused.reason === "offline" ? "Back online" : "Generation paused"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{paused.reason === "offline" ? "Resume to continue processing queued files." : paused.message}</span>
                <Button size="sm" variant="secondary" onClick={resume}>
                  Resume
                </Button>
              </div>
            </Notice>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <DropZone limits={limits} onFiles={addFiles} compact={assets.length > 0} />
            {adding > 0 && (
              <p role="status" className="text-[13px] text-muted">
                Checking {adding} file{adding === 1 ? "" : "s"}…
              </p>
            )}
            {notice && adding === 0 && (
              <p role="status" className="text-[13px] text-muted">
                {notice}
              </p>
            )}
            {assets.length > 0 && (
              <QueuePanel
                assets={assets}
                counts={counts}
                settings={settings}
                actions={queueActions}
                canGenerate={canGenerate}
                generateBlockedReason={blockedReason}
                busy={busy}
              />
            )}
            {reviewable && (
              <ResultsPanel
                assets={assets}
                settings={settings}
                profile={profile}
                canGenerate={canGenerate}
                actions={resultActions}
                filter={filter}
                page={page}
                onFilter={(f) => {
                  setFilter(f);
                  setPage(0);
                }}
                onPage={setPage}
              />
            )}
            {assets.length === 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["1. Add media", "Drop JPEG, PNG, WEBP, SVG, MP4 or MOV files. Each one is checked before anything happens."],
                  ["2. Generate & review", "Gemini drafts metadata per file. Edit titles, descriptions and keyword order."],
                  ["3. Export CSV", "Download a Generic or Adobe Stock CSV. Nothing is uploaded to any marketplace."],
                ].map(([t, d]) => (
                  <div key={t} className="rounded-xl border border-line bg-surface p-4">
                    <p className="text-[14px] font-semibold text-ink">{t}</p>
                    <p className="mt-1 text-[13px] text-muted">{d}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <aside className="min-w-0 space-y-6" aria-label="Settings and export">
            <SettingsPanel settings={settings} update={updateSetting} />
            <ExportPanel candidates={candidates} profile={profile} prefs={prefs} onPrefs={updatePrefs} onJumpTo={jumpTo} />
          </aside>
        </div>
        <p className="sr-only" aria-live="polite">
          {liveSummary}
        </p>
      </main>
      <footer className="border-t border-line py-6 text-center text-[12px] text-faint">
        MetadataGen Gemini · Generated metadata can be wrong — review before use. Not affiliated with Google or any marketplace.
      </footer>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} limits={limits} connection={connection} />
    </>
  );
}

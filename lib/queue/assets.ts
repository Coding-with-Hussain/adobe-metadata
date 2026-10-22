import type { FormatSpec, MediaKind } from "@/lib/config/limits";
import type { MetadataResult, SafeError } from "@/lib/metadata/schema";
import type { GenerationSettings } from "@/lib/metadata/settings";
import { hasErrors, validateMetadata, type EditableMetadata, type ValidationIssue } from "@/lib/metadata/validate";

/** Stored lifecycle state. "completed" is shown as Ready or Needs review depending on validation and flags. */
export type StoredStatus = "rejected" | "queued" | "processing" | "retrying" | "completed" | "failed" | "cancelled" | "idle";
export type DisplayStatus = Exclude<StoredStatus, "completed"> | "ready" | "needs_review";
export type ProcessingStage = "preparing" | "uploading" | "analyzing" | "validating";

export interface Asset {
  /** Stable client-generated id, independent of the filename. */
  id: string;
  file: File;
  name: string;
  size: number;
  kind: MediaKind | null;
  formatLabel: string;
  mimeType: string;
  previewUrl: string | null;
  durationSec: number | null;
  fingerprint: string | null;
  status: StoredStatus;
  stage?: ProcessingStage;
  attempt: number;
  /** Id of the attempt sequence whose result is accepted; anything else is stale. */
  runId: number | null;
  error?: SafeError;
  rejectionReason?: string;
  /** Current (possibly edited) values. */
  metadata?: EditableMetadata;
  /** Values as last generated, used to show whether the user edited them. */
  generated?: EditableMetadata;
  reviewFlags: string[];
  source?: MetadataResult["source"];
  profileFields: Record<string, string>;
}

export interface NewAssetInput {
  id: string;
  file: File;
  format: FormatSpec | null;
  previewUrl: string | null;
  durationSec: number | null;
  fingerprint: string | null;
  rejectionReason?: string;
  warning?: string;
}

export function createAsset(input: NewAssetInput): Asset {
  return {
    id: input.id,
    file: input.file,
    name: input.file.name,
    size: input.file.size,
    kind: input.format?.kind ?? null,
    formatLabel: input.format?.label ?? (input.file.type || "Unknown"),
    mimeType: input.format?.canonicalMime ?? input.file.type,
    previewUrl: input.previewUrl,
    durationSec: input.durationSec,
    fingerprint: input.fingerprint,
    status: input.rejectionReason ? "rejected" : "idle",
    attempt: 0,
    runId: null,
    rejectionReason: input.rejectionReason,
    reviewFlags: input.warning ? [input.warning] : [],
    profileFields: {},
  };
}

export type AssetAction =
  | { type: "add"; assets: Asset[] }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "queue"; ids: string[] }
  | { type: "start"; id: string; runId: number }
  | { type: "stage"; id: string; runId: number; stage: ProcessingStage }
  | { type: "retry"; id: string; runId: number; attempt: number; error: SafeError }
  | { type: "success"; id: string; runId: number; result: MetadataResult }
  | { type: "failure"; id: string; runId: number; error: SafeError }
  | { type: "cancel"; id: string }
  | { type: "edit"; id: string; patch: Partial<EditableMetadata> }
  | { type: "revert"; id: string }
  | { type: "profileField"; id: string; field: string; value: string }
  | { type: "acknowledge"; id: string };

function update(state: Asset[], id: string, fn: (a: Asset) => Asset): Asset[] {
  let changed = false;
  const next = state.map((a) => {
    if (a.id !== id) return a;
    const updated = fn(a);
    if (updated !== a) changed = true;
    return updated;
  });
  return changed ? next : state;
}

/** Pure reducer. Updates are keyed by asset id and run id, so repeated or stale events are no-ops. */
export function assetsReducer(state: Asset[], action: AssetAction): Asset[] {
  switch (action.type) {
    case "add": {
      const existing = new Set(state.map((a) => a.id));
      const fresh = action.assets.filter((a) => !existing.has(a.id));
      return fresh.length ? [...state, ...fresh] : state;
    }
    case "remove":
      return state.filter((a) => a.id !== action.id);
    case "clear":
      return [];
    case "queue": {
      const ids = new Set(action.ids);
      return state.map((a) =>
        ids.has(a.id) && a.status !== "rejected"
          ? { ...a, status: "queued", stage: undefined, error: undefined, attempt: 0 }
          : a,
      );
    }
    case "start":
      return update(state, action.id, (a) =>
        a.status === "rejected" ? a : { ...a, status: "processing", stage: "preparing", runId: action.runId, attempt: 1, error: undefined },
      );
    case "stage":
      return update(state, action.id, (a) => (a.runId === action.runId ? { ...a, stage: action.stage } : a));
    case "retry":
      return update(state, action.id, (a) =>
        a.runId === action.runId ? { ...a, status: "retrying", attempt: action.attempt + 1, error: action.error } : a,
      );
    case "success":
      return update(state, action.id, (a) => {
        if (a.runId !== action.runId || action.result.assetId !== a.id) return a;
        const meta: EditableMetadata = {
          title: action.result.title,
          description: action.result.description,
          keywords: action.result.keywords,
          category: action.result.category,
        };
        return {
          ...a,
          status: "completed",
          stage: undefined,
          error: undefined,
          metadata: meta,
          generated: meta,
          reviewFlags: action.result.reviewFlags,
          source: action.result.source,
          runId: null,
        };
      });
    case "failure":
      // A failed regenerate keeps the previous (possibly edited) metadata and reports the error alongside it.
      return update(state, action.id, (a) =>
        a.runId === action.runId
          ? { ...a, status: a.metadata ? "completed" : "failed", stage: undefined, error: action.error, runId: null }
          : a,
      );
    case "cancel":
      return update(state, action.id, (a) =>
        a.status === "queued" || a.status === "processing" || a.status === "retrying"
          ? { ...a, status: a.metadata ? "completed" : "cancelled", stage: undefined, runId: null }
          : a,
      );
    case "edit":
      return update(state, action.id, (a) => (a.metadata ? { ...a, metadata: { ...a.metadata, ...action.patch } } : a));
    case "revert":
      return update(state, action.id, (a) => (a.generated ? { ...a, metadata: a.generated } : a));
    case "profileField":
      return update(state, action.id, (a) => ({ ...a, profileFields: { ...a.profileFields, [action.field]: action.value } }));
    case "acknowledge":
      return update(state, action.id, (a) => (a.reviewFlags.length ? { ...a, reviewFlags: [] } : a));
  }
}

export function assetIssues(asset: Asset, settings: GenerationSettings): ValidationIssue[] {
  return asset.metadata ? validateMetadata(asset.metadata, settings) : [];
}

export function displayStatus(asset: Asset, settings: GenerationSettings): DisplayStatus {
  if (asset.status !== "completed") return asset.status;
  if (asset.reviewFlags.length > 0 || hasErrors(assetIssues(asset, settings))) return "needs_review";
  return "ready";
}

export function isEdited(asset: Asset): boolean {
  if (!asset.metadata || !asset.generated) return false;
  const a = asset.metadata;
  const b = asset.generated;
  return a.title !== b.title || a.description !== b.description || a.keywords.join("\u0000") !== b.keywords.join("\u0000");
}

export interface BatchCounts {
  total: number;
  rejected: number;
  idle: number;
  queued: number;
  processing: number;
  ready: number;
  needsReview: number;
  failed: number;
  cancelled: number;
}

export function countAssets(assets: Asset[], settings: GenerationSettings): BatchCounts {
  const c: BatchCounts = {
    total: assets.length,
    rejected: 0,
    idle: 0,
    queued: 0,
    processing: 0,
    ready: 0,
    needsReview: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const a of assets) {
    const s = displayStatus(a, settings);
    if (s === "rejected") c.rejected++;
    else if (s === "idle") c.idle++;
    else if (s === "queued") c.queued++;
    else if (s === "processing" || s === "retrying") c.processing++;
    else if (s === "ready") c.ready++;
    else if (s === "needs_review") c.needsReview++;
    else if (s === "failed") c.failed++;
    else if (s === "cancelled") c.cancelled++;
  }
  return c;
}

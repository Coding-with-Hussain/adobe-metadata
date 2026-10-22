import type { AppLimits, MediaKind } from "@/lib/config/limits";
import { buildFilenameOnlyResult } from "@/lib/metadata/normalize";
import { metadataResultSchema, type ErrorCode, type GenerateResponse, type MetadataResult, type SafeError } from "@/lib/metadata/schema";
import type { GenerationSettings } from "@/lib/metadata/settings";
import type { AnalysisPayload } from "@/lib/media/derive";
import type { ProcessingStage } from "./assets";

/** Error carried through the runner with a safe, user-facing message. */
export class ClientError extends Error implements SafeError {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export interface ProcessDeps {
  fetch: typeof fetch;
  prepare: (
    asset: { file: File; kind: MediaKind; mimeType: string },
    settings: GenerationSettings,
    limits: AppLimits,
  ) => Promise<AnalysisPayload>;
}

export interface ProcessInput {
  asset: { id: string; name: string; file: File; kind: MediaKind; mimeType: string };
  settings: GenerationSettings;
  limits: AppLimits;
  signal: AbortSignal;
  onStage: (stage: ProcessingStage) => void;
}

function fromStatus(status: number, retryAfterMs?: number): ClientError {
  if (status === 413) return new ClientError("payload_too_large", "The file is larger than the server accepts.", false);
  if (status === 429) return new ClientError("rate_limited", "The server is rate limiting requests.", true, retryAfterMs);
  if (status === 408 || status === 504) return new ClientError("timeout", "The request timed out.", true);
  if (status >= 500) return new ClientError("provider_unavailable", "The server is temporarily unavailable.", true);
  return new ClientError("internal", `Unexpected server response (HTTP ${status}).`, false);
}

/**
 * Generate metadata for one asset. Filename-only mode is handled entirely in
 * the browser and never calls the API (and therefore never calls Gemini).
 */
export async function processAsset(input: ProcessInput, deps: ProcessDeps): Promise<MetadataResult> {
  const { asset, settings, signal } = input;

  if (settings.filenameOnly) {
    input.onStage("validating");
    return buildFilenameOnlyResult({ assetId: asset.id, filename: asset.name, settings });
  }

  input.onStage("preparing");
  const payload = await deps.prepare(asset, settings, input.limits);
  if (signal.aborted) throw new ClientError("cancelled", "Cancelled.", false);

  const form = new FormData();
  form.append("assetId", asset.id);
  form.append("filename", asset.name);
  form.append("settings", JSON.stringify(settings));
  form.append("derived", payload.derived);
  form.append("file", new File([payload.blob], "asset", { type: payload.mimeType }));

  input.onStage(asset.kind === "video" ? "uploading" : "analyzing");
  let res: Response;
  try {
    res = await deps.fetch("/api/metadata/generate", { method: "POST", body: form, signal });
  } catch (err) {
    if (signal.aborted) throw new ClientError("cancelled", "Cancelled.", false);
    void err;
    throw new ClientError("network", "Could not reach the server. Check your connection.", true);
  }
  if (asset.kind === "video") input.onStage("analyzing");

  const retryAfterHeader = Number(res.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : undefined;

  let body: GenerateResponse;
  try {
    body = (await res.json()) as GenerateResponse;
  } catch {
    throw fromStatus(res.status, retryAfterMs);
  }
  if (!body || typeof body !== "object" || !("ok" in body)) throw fromStatus(res.status, retryAfterMs);
  if (!body.ok) {
    const e = body.error;
    throw new ClientError(e.code, e.message, e.retryable, e.retryAfterMs ?? retryAfterMs);
  }

  input.onStage("validating");
  const parsed = metadataResultSchema.safeParse(body.result);
  if (!parsed.success || parsed.data.assetId !== asset.id) {
    throw new ClientError("malformed_output", "The server returned an unexpected result for this file.", false);
  }
  return parsed.data;
}

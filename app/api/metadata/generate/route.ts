import { maxRequestBytes, readServerConfig } from "@/lib/config/server-env";
import { ANALYSIS_MIME_TYPES, formatBytes } from "@/lib/config/limits";
import { AppError, httpStatusFor, mapProviderError, SAFE_MESSAGES } from "@/lib/gemini/errors";
import { createGeminiClient, generateMetadata } from "@/lib/gemini/provider";
import { signatureMatches, sniffMediaType, SVG_SNIFF_BYTES } from "@/lib/media/signature";
import { buildFilenameOnlyResult } from "@/lib/metadata/normalize";
import type { GenerateResponse } from "@/lib/metadata/schema";
import { generationSettingsSchema } from "@/lib/metadata/settings";
import { cleanInline } from "@/lib/metadata/text";
import { logServer } from "@/lib/server/log";
import { clientKey, RateLimiter } from "@/lib/server/rate-limit";

// Video analysis through the Files API can take a while.
export const maxDuration = 300;

const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const DERIVED_VALUES = new Set(["", "svg", "svg-silhouette", "png-background", "downscaled"]);

let limiter: { key: string; instance: RateLimiter } | null = null;
function getLimiter(perMinute: number, dailyCap: number): RateLimiter {
  const key = `${perMinute}:${dailyCap}`;
  if (!limiter || limiter.key !== key) limiter = { key, instance: new RateLimiter(perMinute, dailyCap) };
  return limiter.instance;
}

function errorResponse(error: AppError, assetId?: string): Response {
  const body: GenerateResponse = { ok: false, ...(assetId ? { assetId } : {}), error: error.toSafe() };
  const headers: HeadersInit = { "Cache-Control": "no-store" };
  if (error.retryAfterMs !== undefined) headers["Retry-After"] = String(Math.ceil(error.retryAfterMs / 1000));
  return Response.json(body, { status: httpStatusFor(error.code), headers });
}

function invalid(message: string, assetId?: string): Response {
  return errorResponse(new AppError("invalid_input", message), assetId);
}

/** Keep only a safe display filename: no path, no control characters. */
function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  return cleanInline(base).slice(0, 255);
}

export async function POST(request: Request): Promise<Response> {
  const config = readServerConfig();

  const decision = getLimiter(config.rateLimitPerMinute, config.dailyRequestCap).check(clientKey(request.headers));
  if (!decision.allowed) {
    const message =
      decision.reason === "daily_cap"
        ? "This server's daily generation cap has been reached. Try again tomorrow or ask the operator to raise DAILY_REQUEST_CAP."
        : "Too many requests from this browser.";
    return errorResponse(
      new AppError(decision.reason === "daily_cap" ? "quota_exceeded" : "rate_limited", message, {
        retryable: decision.reason !== "daily_cap",
        retryAfterMs: decision.retryAfterMs,
      }),
    );
  }

  const limitBytes = maxRequestBytes(config.limits);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > limitBytes) {
    return errorResponse(
      new AppError("payload_too_large", `The upload is larger than the server limit of ${formatBytes(limitBytes)}.`),
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid("Expected a multipart form upload.");
  }

  const assetId = form.get("assetId");
  if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) return invalid("Missing or invalid assetId.");

  const filenameRaw = form.get("filename");
  const filename = typeof filenameRaw === "string" ? sanitizeFilename(filenameRaw) : "";
  if (!filename) return invalid("Missing filename.", assetId);

  let settingsJson: unknown;
  try {
    settingsJson = JSON.parse(String(form.get("settings") ?? ""));
  } catch {
    return invalid("Settings must be JSON.", assetId);
  }
  const parsedSettings = generationSettingsSchema.safeParse(settingsJson);
  if (!parsedSettings.success) return invalid("Settings are invalid.", assetId);
  const settings = parsedSettings.data;

  // Filename-only mode never contacts Gemini, even if a client sends it here.
  if (settings.filenameOnly) {
    const body: GenerateResponse = { ok: true, result: buildFilenameOnlyResult({ assetId, filename, settings }) };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  }

  if (!config.apiKey) return errorResponse(new AppError("not_configured", SAFE_MESSAGES.not_configured), assetId);
  if (config.modelError) return errorResponse(new AppError("model_unavailable", config.modelError), assetId);

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return invalid("Missing media file.", assetId);
  const derived = String(form.get("derived") ?? "");
  if (!DERIVED_VALUES.has(derived)) return invalid("Invalid derived flag.", assetId);

  const mimeType = file.type.toLowerCase();
  if (!(ANALYSIS_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return errorResponse(
      new AppError("unsupported_media", `Media type “${mimeType || "unknown"}” cannot be analysed.`),
      assetId,
    );
  }
  const kind = mimeType.startsWith("video/") ? "video" : "image";
  const maxBytes = kind === "video" ? config.limits.maxVideoBytes : config.limits.maxAnalysisImageBytes;
  if (file.size > maxBytes) {
    return errorResponse(
      new AppError("payload_too_large", `${formatBytes(file.size)} is over the ${formatBytes(maxBytes)} analysis limit.`),
      assetId,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!signatureMatches(mimeType, sniffMediaType(bytes.subarray(0, SVG_SNIFF_BYTES)))) {
    return errorResponse(
      new AppError("unsupported_media", "The file contents do not match its declared type. It may be corrupt."),
      assetId,
    );
  }

  try {
    const result = await generateMetadata({
      client: createGeminiClient(config.apiKey),
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      timeoutMs: config.requestTimeoutMs,
      media: { bytes, mimeType, kind },
      inlineVideoMaxBytes: config.limits.inlineVideoMaxBytes,
      assetId,
      filename,
      settings,
      derived: { fromSvg: derived.startsWith("svg"), silhouette: derived === "svg-silhouette" },
      signal: request.signal,
    });
    const body: GenerateResponse = { ok: true, result };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const mapped = mapProviderError(err);
    if (mapped.code === "internal") logServer("error", "generate.unexpected", { assetId, detail: err });
    return errorResponse(mapped, assetId);
  }
}

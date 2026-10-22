import "server-only";
import { DEFAULT_LIMITS, type AppLimits } from "./limits";

/**
 * Server-only configuration read from environment variables. Never import
 * this from client components: it can see `GEMINI_API_KEY`.
 */

/** Default model, verified against Google's Gemini API model list on 2026-10-22. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Models the server will call unless the operator overrides the list with
 * `GEMINI_ALLOWED_MODELS`. `gemini-3.5-flash` is kept because Google routes
 * it to its replacement during deprecation.
 */
export const DEFAULT_ALLOWED_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash"];

const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.\-]{1,62}$/;
export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevelSetting = (typeof THINKING_LEVELS)[number];

export interface ServerConfig {
  apiKey: string | null;
  model: string;
  allowedModels: string[];
  /** Null when the configured model is acceptable, otherwise a safe explanation. */
  modelError: string | null;
  thinkingLevel: ThinkingLevelSetting | null;
  requestTimeoutMs: number;
  limits: AppLimits;
  rateLimitPerMinute: number;
  dailyRequestCap: number;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const MB = 1024 * 1024;

export function readServerConfig(env: Env = process.env): ServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() || null;
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const configuredAllowlist = (env.GEMINI_ALLOWED_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  // An empty value (e.g. copied from .env.example) means "use the defaults", not "allow nothing".
  const allowedModels = configuredAllowlist.length > 0 ? configuredAllowlist : DEFAULT_ALLOWED_MODELS;

  let modelError: string | null = null;
  if (!MODEL_ID_PATTERN.test(model)) {
    modelError = "GEMINI_MODEL is not a valid model ID.";
  } else if (!allowedModels.includes(model)) {
    modelError = `GEMINI_MODEL “${model}” is not in the server allowlist. Add it to GEMINI_ALLOWED_MODELS or use ${DEFAULT_GEMINI_MODEL}.`;
  }

  const thinkingRaw = env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  const thinkingLevel = THINKING_LEVELS.includes(thinkingRaw as ThinkingLevelSetting)
    ? (thinkingRaw as ThinkingLevelSetting)
    : null;

  const d = DEFAULT_LIMITS;
  const mb = (name: string, fallback: number, min: number, max: number) => Math.floor(num(env, name, fallback / MB, min, max) * MB);
  const limits: AppLimits = {
    maxImageBytes: mb("MAX_IMAGE_MB", d.maxImageBytes, 1, 200),
    maxSvgBytes: mb("MAX_SVG_MB", d.maxSvgBytes, 0.1, 20),
    maxVideoBytes: mb("MAX_VIDEO_MB", d.maxVideoBytes, 1, 2000),
    maxVideoSeconds: num(env, "MAX_VIDEO_SECONDS", d.maxVideoSeconds, 1, 3600),
    maxAnalysisImageBytes: mb("MAX_ANALYSIS_IMAGE_MB", d.maxAnalysisImageBytes, 1, 14),
    inlineVideoMaxBytes: mb("INLINE_VIDEO_MAX_MB", d.inlineVideoMaxBytes, 0, 14),
    maxBatchFiles: Math.floor(num(env, "MAX_BATCH_FILES", d.maxBatchFiles, 1, 1000)),
    clientConcurrency: Math.floor(num(env, "CLIENT_CONCURRENCY", d.clientConcurrency, 1, 8)),
  };

  return {
    apiKey,
    model,
    allowedModels,
    modelError,
    thinkingLevel,
    requestTimeoutMs: num(env, "GEMINI_REQUEST_TIMEOUT_MS", 120_000, 5_000, 600_000),
    limits,
    rateLimitPerMinute: Math.floor(num(env, "RATE_LIMIT_PER_MINUTE", 60, 1, 10_000)),
    dailyRequestCap: Math.floor(num(env, "DAILY_REQUEST_CAP", 2000, 0, 1_000_000)),
  };
}

/** Largest multipart body the generate endpoint will read. */
export function maxRequestBytes(limits: AppLimits): number {
  return Math.max(limits.maxAnalysisImageBytes, limits.maxVideoBytes) + 1 * MB;
}

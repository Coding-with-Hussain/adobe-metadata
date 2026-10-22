import type { ErrorCode, SafeError } from "@/lib/metadata/schema";

/**
 * Error raised inside the app with a safe, user-facing message. Provider
 * errors are converted into this shape by `mapProviderError`; raw provider
 * messages never reach API responses.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message: string, options: { retryable?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }

  toSafe(): SafeError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterMs !== undefined ? { retryAfterMs: this.retryAfterMs } : {}),
    };
  }
}

export const SAFE_MESSAGES: Record<ErrorCode, string> = {
  not_configured: "Gemini is not configured on the server. Set GEMINI_API_KEY and restart the app.",
  unauthorized: "Gemini rejected the server's API key. Check GEMINI_API_KEY and that the Gemini API is enabled for it.",
  model_unavailable: "The configured Gemini model is not available to this API key. Check GEMINI_MODEL.",
  rate_limited: "Gemini is rate limiting requests.",
  quota_exceeded: "The Gemini quota for this API key is exhausted. Try again later or raise the quota.",
  provider_unavailable: "Gemini is temporarily unavailable.",
  network: "Could not reach the server or Gemini. Check the connection and retry.",
  timeout: "The request to Gemini timed out.",
  malformed_output: "Gemini returned output that did not match the expected format, even after one corrective retry.",
  blocked: "Gemini declined to describe this asset (safety or policy filter). Add metadata manually or try filename-only mode.",
  invalid_input: "The request was invalid.",
  unsupported_media: "This media type cannot be analysed.",
  payload_too_large: "The file is larger than the server allows.",
  media_processing_failed: "Gemini could not process this media file. It may be corrupt or in an unsupported codec.",
  cancelled: "The request was cancelled.",
  internal: "Something went wrong on the server while generating metadata.",
};

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  cause?: unknown;
}

function asErrorLike(err: unknown): ErrorLike {
  return typeof err === "object" && err !== null ? (err as ErrorLike) : {};
}

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET"]);

/** Extract "retry in Ns" hints that Google includes in 429 responses. */
export function parseRetryAfterMs(message: string): number | undefined {
  const m = /retry(?:Delay)?["'\s:]*(?:in\s+)?(\d+(?:\.\d+)?)\s*s/i.exec(message);
  if (!m) return undefined;
  const ms = Math.round(Number(m[1]) * 1000);
  return Number.isFinite(ms) ? Math.min(ms, 120_000) : undefined;
}

function make(code: ErrorCode, retryable: boolean, retryAfterMs?: number): AppError {
  return new AppError(code, SAFE_MESSAGES[code], { retryable, retryAfterMs });
}

/** Map any error thrown while talking to Gemini into a safe AppError. */
export function mapProviderError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = asErrorLike(err);
  const message = typeof e.message === "string" ? e.message : "";
  const name = typeof e.name === "string" ? e.name : "";

  if (name === "AbortError") return make("cancelled", false);
  if (name === "TimeoutError" || /timed? ?out/i.test(message)) return make("timeout", true);

  const status = typeof e.status === "number" ? e.status : undefined;
  if (status !== undefined) {
    if (status === 400) {
      if (/api[ _]?key/i.test(message)) return make("unauthorized", false);
      if (/model/i.test(message) && /(not found|not supported|unsupported|invalid)/i.test(message))
        return make("model_unavailable", false);
      return make("invalid_input", false);
    }
    if (status === 401 || status === 403) return make("unauthorized", false);
    if (status === 404) return make("model_unavailable", false);
    if (status === 408 || status === 504) return make("timeout", true);
    if (status === 413) return make("payload_too_large", false);
    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(message);
      if (/per ?day|daily|billing|exceeded your current quota/i.test(message)) return make("quota_exceeded", false, retryAfterMs);
      return make("rate_limited", true, retryAfterMs);
    }
    if (status >= 500) return make("provider_unavailable", true);
    return make("internal", false);
  }

  const cause = asErrorLike(e.cause);
  const code = typeof e.code === "string" ? e.code : typeof cause.code === "string" ? cause.code : "";
  if (NETWORK_CODES.has(code) || (name === "TypeError" && /fetch failed|network/i.test(message))) {
    return make("network", true);
  }
  return make("internal", false);
}

/** HTTP status for an error code returned by our API. */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "invalid_input":
      return 400;
    case "payload_too_large":
      return 413;
    case "unsupported_media":
      return 415;
    case "malformed_output":
    case "blocked":
    case "media_processing_failed":
      return 422;
    case "rate_limited":
    case "quota_exceeded":
      return 429;
    case "cancelled":
      return 499;
    case "not_configured":
      return 503;
    case "timeout":
      return 504;
    case "unauthorized":
    case "model_unavailable":
    case "provider_unavailable":
    case "network":
      return 502;
    default:
      return 500;
  }
}

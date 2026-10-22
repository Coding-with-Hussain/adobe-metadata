import "server-only";

/**
 * Minimal structured server logger. It never logs media, prompts, filenames
 * or secrets: error details are reduced to name/status and a short message
 * with anything resembling an API key or URL query string removed.
 */

type Level = "info" | "warn" | "error";

const KEY_PATTERNS = [
  /AIza[0-9A-Za-z_\-]{10,}/g, // Google API keys
  /([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi,
  /(x-goog-api-key["'\s:=]+)[^\s"',}]+/gi,
  /(Bearer\s+)[A-Za-z0-9._\-]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const p of KEY_PATTERNS) out = out.replace(p, (_m, prefix?: string) => `${typeof prefix === "string" ? prefix : ""}[redacted]`);
  const secret = process.env.GEMINI_API_KEY;
  if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  return out;
}

function describe(detail: unknown): Record<string, unknown> {
  if (typeof detail !== "object" || detail === null) return { message: redact(String(detail)).slice(0, 300) };
  const e = detail as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  return {
    name: typeof e.name === "string" ? e.name : undefined,
    status: typeof e.status === "number" ? e.status : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
    message: typeof e.message === "string" ? redact(e.message).slice(0, 300) : undefined,
  };
}

export function logServer(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const { detail, ...rest } = fields;
  const entry: Record<string, unknown> = { level, event, ...rest };
  if (detail !== undefined) entry.detail = describe(detail);
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

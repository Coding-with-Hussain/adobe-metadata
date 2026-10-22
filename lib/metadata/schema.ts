import { z } from "zod";

/**
 * What Gemini is asked to return. Parsed locally even when the provider
 * enforces the JSON schema, because provider-side schema support is not a
 * guarantee of valid content.
 */
export const modelOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()).min(1).max(200),
  category: z.string().nullish(),
  reviewFlags: z.array(z.string()).nullish(),
  inapplicableIncludeTerms: z.array(z.string()).nullish(),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** JSON Schema sent to Gemini as `responseJsonSchema`. Kept in sync with `modelOutputSchema`. */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Concise, accurate stock title." },
    description: { type: "string", description: "Natural, specific one- or two-sentence description." },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Keywords ordered from most to least relevant.",
    },
    category: { type: "string", description: "One short, lower-case subject category, e.g. wildlife." },
    reviewFlags: {
      type: "array",
      items: { type: "string" },
      description: "Short notes about uncertain or ambiguous content a human should check. Empty if none.",
    },
    inapplicableIncludeTerms: {
      type: "array",
      items: { type: "string" },
      description: "Requested include terms that do not match the visible content. Empty if none.",
    },
  },
  required: ["title", "description", "keywords", "category", "reviewFlags", "inapplicableIncludeTerms"],
  propertyOrdering: ["title", "description", "keywords", "category", "reviewFlags", "inapplicableIncludeTerms"],
} as const;

export const METADATA_SOURCES = ["gemini", "filename"] as const;

/** Normalized result contract shared by the API and the UI. `assetId` and `filename` are set by the app, never by the model. */
export const metadataResultSchema = z.object({
  assetId: z.string().min(1).max(100),
  filename: z.string().min(1).max(255),
  title: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  category: z.string().optional(),
  reviewFlags: z.array(z.string()),
  source: z.enum(METADATA_SOURCES),
});
export type MetadataResult = z.infer<typeof metadataResultSchema>;

/** Error codes the API can return. Messages shown to users are mapped from these. */
export const ERROR_CODES = [
  "not_configured",
  "unauthorized",
  "model_unavailable",
  "rate_limited",
  "quota_exceeded",
  "provider_unavailable",
  "network",
  "timeout",
  "malformed_output",
  "blocked",
  "invalid_input",
  "unsupported_media",
  "payload_too_large",
  "media_processing_failed",
  "cancelled",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SafeError {
  code: ErrorCode;
  message: string;
  /** Whether retrying the same request later may succeed. */
  retryable: boolean;
  /** Suggested wait before retrying, when the provider told us. */
  retryAfterMs?: number;
}

export type GenerateResponse =
  | { ok: true; result: MetadataResult }
  | { ok: false; assetId?: string; error: SafeError };

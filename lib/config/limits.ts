/**
 * Single source of truth for media formats and processing limits.
 *
 * These defaults are safe to import from client and server code. The server
 * may override the numeric limits through environment variables (see
 * `lib/config/server-env.ts`); the UI receives the effective values from
 * `GET /api/health` so its guidance always matches what the server enforces.
 */

export type MediaKind = "image" | "svg" | "video";

export interface FormatSpec {
  /** Lower-case extensions including the dot. */
  extensions: string[];
  /** MIME types a browser may report for this format. */
  mimeTypes: string[];
  /** Canonical MIME type used internally and sent to Gemini. */
  canonicalMime: string;
  kind: MediaKind;
  label: string;
}

export const SUPPORTED_FORMATS: FormatSpec[] = [
  {
    label: "JPEG",
    extensions: [".jpg", ".jpeg"],
    mimeTypes: ["image/jpeg", "image/pjpeg"],
    canonicalMime: "image/jpeg",
    kind: "image",
  },
  {
    label: "PNG",
    extensions: [".png"],
    mimeTypes: ["image/png"],
    canonicalMime: "image/png",
    kind: "image",
  },
  {
    label: "WEBP",
    extensions: [".webp"],
    mimeTypes: ["image/webp"],
    canonicalMime: "image/webp",
    kind: "image",
  },
  {
    label: "SVG",
    extensions: [".svg"],
    mimeTypes: ["image/svg+xml"],
    canonicalMime: "image/svg+xml",
    kind: "svg",
  },
  {
    label: "MP4",
    extensions: [".mp4"],
    mimeTypes: ["video/mp4"],
    canonicalMime: "video/mp4",
    kind: "video",
  },
  {
    label: "MOV",
    extensions: [".mov"],
    mimeTypes: ["video/quicktime", "video/mov"],
    canonicalMime: "video/quicktime",
    kind: "video",
  },
];

/** MIME types the server accepts as an analysis payload (SVG is rasterized to PNG in the browser first). */
export const ANALYSIS_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
] as const;
export type AnalysisMime = (typeof ANALYSIS_MIME_TYPES)[number];

export interface AppLimits {
  /** Maximum size of a selected raster image (JPEG/PNG/WEBP) in bytes. */
  maxImageBytes: number;
  /** Maximum size of a selected SVG file in bytes. */
  maxSvgBytes: number;
  /** Maximum size of a selected video in bytes. */
  maxVideoBytes: number;
  /** Maximum video duration in seconds (checked in the browser when metadata is readable). */
  maxVideoSeconds: number;
  /** Maximum size of the image payload actually sent for analysis; larger images are downscaled in the browser first. */
  maxAnalysisImageBytes: number;
  /** Videos up to this size are sent inline; larger ones go through the Gemini Files API. */
  inlineVideoMaxBytes: number;
  /** Maximum number of files in one batch. */
  maxBatchFiles: number;
  /** Concurrent generation requests per browser tab. */
  clientConcurrency: number;
}

const MB = 1024 * 1024;

export const DEFAULT_LIMITS: AppLimits = {
  maxImageBytes: 50 * MB,
  maxSvgBytes: 5 * MB,
  maxVideoBytes: 100 * MB,
  maxVideoSeconds: 300,
  // Inline requests should stay under Gemini's ~20 MB request size; base64 adds about a third.
  maxAnalysisImageBytes: 14 * MB,
  inlineVideoMaxBytes: 14 * MB,
  maxBatchFiles: 500,
  clientConcurrency: 3,
};

/** Long edge, in pixels, of the analysis-only derivative created for oversized images and SVGs. */
export const ANALYSIS_MAX_EDGE_PX = 2048;

export function findFormatByExtension(filename: string): FormatSpec | undefined {
  const ext = getExtension(filename);
  if (!ext) return undefined;
  return SUPPORTED_FORMATS.find((f) => f.extensions.includes(ext));
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return "";
  return filename.slice(idx).toLowerCase();
}

export function maxBytesForKind(kind: MediaKind, limits: AppLimits): number {
  if (kind === "video") return limits.maxVideoBytes;
  if (kind === "svg") return limits.maxSvgBytes;
  return limits.maxImageBytes;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  const mb = bytes / MB;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

export const SUPPORTED_EXTENSIONS_LABEL = SUPPORTED_FORMATS.map((f) => f.label).join(", ");

export const ACCEPT_ATTRIBUTE = SUPPORTED_FORMATS.flatMap((f) => [...f.extensions, ...f.mimeTypes]).join(",");

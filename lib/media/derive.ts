import { ANALYSIS_MAX_EDGE_PX, type AppLimits, type MediaKind } from "@/lib/config/limits";
import type { GenerationSettings } from "@/lib/metadata/settings";

/**
 * Browser-only helpers that build the analysis payload. Originals are never
 * modified: every transformation produces a separate, analysis-only Blob.
 *
 * SVG safety: SVG is untrusted markup. It is parsed with DOMParser only to
 * check well-formedness (parsing does not execute scripts) and rendered
 * through an <img> element, where scripts never run and external resources
 * are not loaded. Its markup is never inserted into the page.
 */

export type DerivedKind = "" | "svg" | "svg-silhouette" | "png-background" | "downscaled";

export interface AnalysisPayload {
  blob: Blob;
  mimeType: string;
  derived: DerivedKind;
}

export class MediaPrepError extends Error {
  readonly code = "unsupported_media" as const;
  readonly retryable = false;
}

/** Raster images above this size are downscaled for analysis to keep requests small. */
export const DOWNSCALE_THRESHOLD_BYTES = 7 * 1024 * 1024;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new MediaPrepError("The image could not be decoded."));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new MediaPrepError("Could not create the analysis image."))), type, quality);
    } catch {
      // A SecurityError here means the browser considers the canvas tainted.
      reject(new MediaPrepError("This file could not be rendered safely in the browser."));
    }
  });
}

function fitWithin(width: number, height: number, maxEdge: number, minEdge = 0) {
  const long = Math.max(width, height);
  let scale = long > maxEdge ? maxEdge / long : 1;
  if (minEdge > 0 && long * scale < minEdge) scale = minEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function svgIntrinsicSize(doc: Document): { width: number; height: number } | null {
  const root = doc.documentElement;
  const vb = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const w = parseFloat(root.getAttribute("width") ?? "");
  const h = parseFloat(root.getAttribute("height") ?? "");
  if (w > 0 && h > 0) return { width: w, height: h };
  return null;
}

/** Parse SVG text without rendering it. Throws MediaPrepError for malformed input. */
export function parseSvg(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || doc.documentElement.localName !== "svg") {
    throw new MediaPrepError("The SVG is not well-formed XML with an <svg> root element.");
  }
  return doc;
}

async function rasterizeSvg(file: File, silhouette: boolean): Promise<AnalysisPayload> {
  const doc = parseSvg(await file.text());
  const size = svgIntrinsicSize(doc) ?? { width: 1024, height: 1024 };
  const target = fitWithin(size.width, size.height, ANALYSIS_MAX_EDGE_PX, 1024);
  const url = URL.createObjectURL(new Blob([file], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MediaPrepError("Canvas is not available in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(img, 0, 0, target.width, target.height);

    if (silhouette) {
      // Lossy outline mode: every visible pixel becomes black on white.
      const clean = document.createElement("canvas");
      clean.width = target.width;
      clean.height = target.height;
      const cctx = clean.getContext("2d")!;
      cctx.drawImage(img, 0, 0, target.width, target.height);
      const data = cctx.getImageData(0, 0, target.width, target.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i + 3] > 24 ? 0 : 255;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
    }
    return {
      blob: await canvasToBlob(canvas, "image/png"),
      mimeType: "image/png",
      derived: silhouette ? "svg-silhouette" : "svg",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function redrawRaster(
  file: File,
  options: { background: string | null; maxEdge: number; type: "image/png" | "image/jpeg" },
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const target = fitWithin(img.naturalWidth, img.naturalHeight, options.maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new MediaPrepError("Canvas is not available in this browser.");
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, target.width, target.height);
    }
    ctx.drawImage(img, 0, 0, target.width, target.height);
    return await canvasToBlob(canvas, options.type, options.type === "image/jpeg" ? 0.9 : undefined);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareAnalysisPayload(
  asset: { file: File; kind: MediaKind; mimeType: string },
  settings: GenerationSettings,
  limits: AppLimits,
): Promise<AnalysisPayload> {
  const { file, kind, mimeType } = asset;
  if (kind === "video") return { blob: file, mimeType, derived: "" };
  if (kind === "svg") return rasterizeSvg(file, settings.svgMode === "silhouette");

  const isPng = mimeType === "image/png";
  const background = isPng && settings.pngBackground !== "transparent" ? (settings.pngBackground === "white" ? "#ffffff" : "#000000") : null;
  const needsDownscale = file.size > DOWNSCALE_THRESHOLD_BYTES;

  if (!background && !needsDownscale) return { blob: file, mimeType, derived: "" };

  // PNG keeps transparency when it is preserved; JPEG keeps large opaque images small.
  const keepsAlpha = isPng && !background;
  const outType = keepsAlpha || !needsDownscale ? "image/png" : "image/jpeg";
  try {
    const blob = await redrawRaster(file, {
      background,
      maxEdge: needsDownscale ? ANALYSIS_MAX_EDGE_PX : 8192,
      type: outType,
    });
    if (blob.size > limits.maxAnalysisImageBytes) {
      throw new MediaPrepError("The analysis copy of this image is still too large.");
    }
    return { blob, mimeType: blob.type || outType, derived: background ? "png-background" : "downscaled" };
  } catch (err) {
    // Fall back to the original when it is small enough to send as-is.
    if (file.size <= limits.maxAnalysisImageBytes && !background) return { blob: file, mimeType, derived: "" };
    throw err instanceof MediaPrepError ? err : new MediaPrepError("The image could not be prepared for analysis.");
  }
}

/** Read a video's duration from its metadata; null when the browser cannot decode it. */
export function readVideoDuration(url: string, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

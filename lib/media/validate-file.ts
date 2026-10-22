import {
  findFormatByExtension,
  formatBytes,
  getExtension,
  maxBytesForKind,
  SUPPORTED_EXTENSIONS_LABEL,
  type AppLimits,
  type FormatSpec,
} from "@/lib/config/limits";
import { SIGNATURE_BYTES, SVG_SNIFF_BYTES, signatureMatches, sniffMediaType } from "./signature";

export type FileCheckResult = { ok: true; format: FormatSpec } | { ok: false; reason: string };

export interface FileLike {
  name: string;
  size: number;
  type: string;
}

/** Checks that need no file contents: emptiness, extension, reported MIME type and size. */
export function checkFileBasics(file: FileLike, limits: AppLimits): FileCheckResult {
  if (file.size === 0) return { ok: false, reason: "The file is empty." };
  const format = findFormatByExtension(file.name);
  if (!format) {
    const ext = getExtension(file.name) || "no extension";
    return { ok: false, reason: `Unsupported file type (${ext}). Supported: ${SUPPORTED_EXTENSIONS_LABEL}.` };
  }
  if (file.type && !format.mimeTypes.includes(file.type.toLowerCase())) {
    return {
      ok: false,
      reason: `The file extension says ${format.label} but the browser reports “${file.type}”. The file may be renamed.`,
    };
  }
  const max = maxBytesForKind(format.kind, limits);
  if (file.size > max) {
    return {
      ok: false,
      reason: `${formatBytes(file.size)} is over the ${formatBytes(max)} limit for ${format.label} files.`,
    };
  }
  return { ok: true, format };
}

/** Compare the leading bytes with the format the extension claims. */
export function checkSignature(format: FormatSpec, head: Uint8Array): FileCheckResult {
  const sniffed = sniffMediaType(head);
  if (!signatureMatches(format.canonicalMime, sniffed)) {
    return {
      ok: false,
      reason: `The contents do not look like a valid ${format.label} file. It may be corrupt or renamed.`,
    };
  }
  return { ok: true, format };
}

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

/** Full selection-time validation for a browser `File`. */
export async function validateSelectedFile(file: File, limits: AppLimits): Promise<FileCheckResult> {
  const basics = checkFileBasics(file, limits);
  if (!basics.ok) return basics;
  const headLength = basics.format.kind === "svg" ? SVG_SNIFF_BYTES : SIGNATURE_BYTES;
  try {
    const head = await readBytes(file, 0, headLength);
    return checkSignature(basics.format, head);
  } catch {
    return { ok: false, reason: "The file could not be read." };
  }
}

const FINGERPRINT_CHUNK = 1024 * 1024;

/**
 * Content fingerprint used to detect duplicates within a batch, independent
 * of filename: SHA-256 over the size plus the first and last megabyte.
 */
export async function fingerprintFile(file: Blob): Promise<string> {
  const head = await readBytes(file, 0, FINGERPRINT_CHUNK);
  const tail = file.size > FINGERPRINT_CHUNK ? await readBytes(file, Math.max(FINGERPRINT_CHUNK, file.size - FINGERPRINT_CHUNK), file.size) : new Uint8Array();
  const sizeBytes = new TextEncoder().encode(String(file.size));
  const data = new Uint8Array(sizeBytes.length + head.length + tail.length);
  data.set(sizeBytes, 0);
  data.set(head, sizeBytes.length);
  data.set(tail, sizeBytes.length + head.length);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

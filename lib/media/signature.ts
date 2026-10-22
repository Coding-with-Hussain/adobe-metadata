/**
 * Magic-byte sniffing for the supported formats. Shared by the browser
 * (selection-time validation) and the server (payload validation), so a file
 * is never trusted on its extension or reported MIME type alone.
 */

export type SniffedType = "image/jpeg" | "image/png" | "image/webp" | "image/svg+xml" | "video/mp4" | "video/quicktime";

/** Number of leading bytes needed by `sniffMediaType` for binary formats. */
export const SIGNATURE_BYTES = 64;
/** Leading bytes inspected when looking for an `<svg` root element. */
export const SVG_SNIFF_BYTES = 4096;

const QUICKTIME_ATOMS = new Set(["moov", "mdat", "wide", "free", "skip", "pnot"]);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function sniffMediaType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 4) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";

  if (bytes.length >= 12) {
    const box = ascii(bytes, 4, 8);
    if (box === "ftyp") {
      const brand = ascii(bytes, 8, 12);
      return brand === "qt  " ? "video/quicktime" : "video/mp4";
    }
    if (QUICKTIME_ATOMS.has(box)) return "video/quicktime";
  }

  if (looksLikeSvg(bytes)) return "image/svg+xml";
  return null;
}

/** Text check for an SVG root element near the start of the file. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, SVG_SNIFF_BYTES));
  } catch {
    return false;
  }
  text = text.replace(/^\uFEFF/, "").trimStart();
  if (!text.startsWith("<")) return false;
  // Skip XML declaration, comments and doctype, then expect <svg.
  const stripped = text
    .replace(/^<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/i, "")
    .trimStart();
  return /^<svg[\s>]/i.test(stripped);
}

/** MP4 and MOV share the ISO-BMFF container, so either signature is accepted for either extension. */
export function signatureMatches(declared: string, sniffed: SniffedType | null): boolean {
  if (!sniffed) return false;
  const isVideo = (t: string) => t === "video/mp4" || t === "video/quicktime";
  if (isVideo(declared) && isVideo(sniffed)) return true;
  return declared === sniffed;
}

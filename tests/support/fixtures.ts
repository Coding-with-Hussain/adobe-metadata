/** Minimal byte sequences with valid signatures for each supported format. */
function bytes(...parts: (number[] | string)[]): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

export const FIXTURES = {
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0x00, 0x01, 0x01, 0x00, 0x00, 0x01]),
  png: bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], [0x00, 0x00, 0x00, 0x0d], "IHDR", [0, 0, 0, 1, 0, 0, 0, 1]),
  webp: bytes("RIFF", [0x24, 0, 0, 0], "WEBP", "VP8 "),
  mp4: bytes([0, 0, 0, 0x18], "ftyp", "isom", [0, 0, 0, 0], "isom", "mp42"),
  mov: bytes([0, 0, 0, 0x14], "ftyp", "qt  ", [0, 0, 0, 0], "qt  "),
  svg: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
};

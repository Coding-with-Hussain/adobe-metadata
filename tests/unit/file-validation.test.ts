import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, findFormatByExtension } from "@/lib/config/limits";
import { signatureMatches, sniffMediaType } from "@/lib/media/signature";
import { checkFileBasics, checkSignature, fingerprintFile, validateSelectedFile } from "@/lib/media/validate-file";
import { FIXTURES } from "../support/fixtures";

describe("sniffMediaType", () => {
  it("detects each supported format from its leading bytes", () => {
    expect(sniffMediaType(FIXTURES.jpeg)).toBe("image/jpeg");
    expect(sniffMediaType(FIXTURES.png)).toBe("image/png");
    expect(sniffMediaType(FIXTURES.webp)).toBe("image/webp");
    expect(sniffMediaType(FIXTURES.mp4)).toBe("video/mp4");
    expect(sniffMediaType(FIXTURES.mov)).toBe("video/quicktime");
    expect(sniffMediaType(FIXTURES.svg)).toBe("image/svg+xml");
    expect(sniffMediaType(new TextEncoder().encode('<?xml version="1.0"?>\n<!-- x -->\n<svg></svg>'))).toBe(
      "image/svg+xml",
    );
  });

  it("returns null for unknown content", () => {
    expect(sniffMediaType(new TextEncoder().encode("hello world, not an image"))).toBeNull();
    expect(sniffMediaType(new TextEncoder().encode("<html><svg></svg></html>"))).toBeNull();
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });

  it("treats MP4 and MOV containers as interchangeable", () => {
    expect(signatureMatches("video/quicktime", "video/mp4")).toBe(true);
    expect(signatureMatches("image/png", "image/jpeg")).toBe(false);
  });
});

describe("checkFileBasics", () => {
  it("rejects empty files", () => {
    expect(checkFileBasics({ name: "a.jpg", size: 0, type: "image/jpeg" }, DEFAULT_LIMITS)).toMatchObject({
      ok: false,
      reason: "The file is empty.",
    });
  });
  it("rejects unsupported extensions with the supported list", () => {
    const res = checkFileBasics({ name: "a.tiff", size: 10, type: "image/tiff" }, DEFAULT_LIMITS);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/\.tiff.*JPEG, PNG, WEBP, SVG, MP4, MOV/);
  });
  it("rejects a reported MIME type that contradicts the extension", () => {
    const res = checkFileBasics({ name: "a.jpg", size: 10, type: "image/png" }, DEFAULT_LIMITS);
    expect(res.ok).toBe(false);
  });
  it("rejects oversize files using the configured per-kind limit", () => {
    const res = checkFileBasics(
      { name: "clip.mp4", size: DEFAULT_LIMITS.maxVideoBytes + 1, type: "video/mp4" },
      DEFAULT_LIMITS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/over the 100 MB limit/);
  });
  it("accepts a valid file and an empty reported MIME type", () => {
    expect(checkFileBasics({ name: "a.JPG", size: 10, type: "" }, DEFAULT_LIMITS).ok).toBe(true);
  });
});

describe("checkSignature", () => {
  it("rejects a renamed file", () => {
    const res = checkSignature(findFormatByExtension("x.jpg")!, FIXTURES.png);
    expect(res.ok).toBe(false);
  });
  it("accepts a matching file", () => {
    expect(checkSignature(findFormatByExtension("x.png")!, FIXTURES.png).ok).toBe(true);
  });
});

describe("validateSelectedFile", () => {
  it("validates a browser File end to end", async () => {
    const good = new File([FIXTURES.png], "ok.png", { type: "image/png" });
    expect((await validateSelectedFile(good, DEFAULT_LIMITS)).ok).toBe(true);
    const corrupt = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], "bad.png", {
      type: "image/png",
    });
    expect((await validateSelectedFile(corrupt, DEFAULT_LIMITS)).ok).toBe(false);
  });
});

describe("fingerprintFile", () => {
  it("matches identical content regardless of name and differs otherwise", async () => {
    const a = await fingerprintFile(new File([FIXTURES.png], "a.png"));
    const b = await fingerprintFile(new File([FIXTURES.png], "b.png"));
    const c = await fingerprintFile(new File([FIXTURES.jpeg], "a.png"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

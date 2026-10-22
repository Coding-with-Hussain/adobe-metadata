import { describe, expect, it } from "vitest";
import { charCount, cleanInline, composeWithAffixes, truncateText } from "@/lib/metadata/text";

describe("charCount", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(charCount("abc")).toBe(3);
    expect(charCount("🦊🦊")).toBe(2);
    expect("🦊🦊".length).toBe(4);
    expect(charCount("café")).toBe(4);
  });
});

describe("cleanInline", () => {
  it("collapses whitespace, newlines and strips control characters", () => {
    expect(cleanInline("  Red\tfox\r\n in   snow\u0000 ")).toBe("Red fox in snow");
    expect(cleanInline("zero\u200Bwidth")).toBe("zerowidth");
  });
});

describe("truncateText", () => {
  it("returns text unchanged when within the limit", () => {
    expect(truncateText("Red fox", 7)).toBe("Red fox");
  });

  it("cuts at a word boundary and never exceeds the limit", () => {
    const out = truncateText("Red fox standing in a snow-covered forest", 20);
    expect(out).toBe("Red fox standing in");
    expect(charCount(out)).toBeLessThanOrEqual(20);
  });

  it("hard-cuts a single long word when no good boundary exists", () => {
    const out = truncateText("Supercalifragilisticexpialidocious", 10);
    expect(out).toBe("Supercalif");
  });

  it("strips trailing separators after cutting", () => {
    expect(truncateText("Fox, wolf, bear and deer", 11)).toBe("Fox, wolf");
  });

  it("never splits an emoji or a combining sequence", () => {
    const emoji = "Wave 👋🏽 hello";
    // "Wave " is 5 code points, the emoji with skin tone is 2 code points.
    const out = truncateText(emoji, 6);
    expect(out).toBe("Wave");
    const combining = "Cafe\u0301 au lait"; // e + combining acute
    expect(truncateText(combining, 4)).toBe("Caf");
    expect(charCount(truncateText(combining, 5))).toBeLessThanOrEqual(5);
  });

  it("handles CJK text without spaces", () => {
    const out = truncateText("雪の森に立つアカギツネ", 5);
    expect(out).toBe("雪の森に立");
  });
});

describe("composeWithAffixes", () => {
  it("joins prefix, body and suffix with single spaces", () => {
    expect(composeWithAffixes("red fox", "Vector:", "- isolated", 50)).toEqual({
      value: "Vector: red fox - isolated",
      truncated: false,
    });
  });

  it("shortens only the body so the final value fits exactly", () => {
    const res = composeWithAffixes("Red fox standing in deep snow", "AI:", "(4K)", 20);
    expect(res.value.startsWith("AI: ")).toBe(true);
    expect(res.value.endsWith(" (4K)")).toBe(true);
    expect(charCount(res.value)).toBeLessThanOrEqual(20);
    expect(res.truncated).toBe(true);
  });

  it("fits at the exact boundary", () => {
    // prefix(2) + space + body(5) + space + suffix(2) = 11
    const res = composeWithAffixes("hello", "ab", "cd", 11);
    expect(res.value).toBe("ab hello cd");
    expect(res.truncated).toBe(false);
    const tight = composeWithAffixes("hello", "ab", "cd", 10);
    expect(charCount(tight.value)).toBeLessThanOrEqual(10);
    expect(tight.value).toBe("ab hell cd");
  });

  it("reports an error when affixes leave no room", () => {
    const res = composeWithAffixes("body", "a very long prefix", "and suffix", 20);
    expect(res.error).toMatch(/no room/);
    expect(charCount(res.value)).toBeLessThanOrEqual(20);
  });

  it("works with empty affixes", () => {
    expect(composeWithAffixes("  body  ", "", "", 10).value).toBe("body");
  });
});

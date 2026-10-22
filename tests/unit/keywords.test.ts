import { describe, expect, it } from "vitest";
import {
  applyKeywordStyle,
  containsTerm,
  dedupeKeywords,
  normalizeKeyword,
  processKeywords,
} from "@/lib/metadata/keywords";

const base = { count: 10, style: "auto" as const, includeTerms: [], excludeTerms: [] };

describe("normalizeKeyword", () => {
  it("trims punctuation, hashes and whitespace", () => {
    expect(normalizeKeyword("  #Red Fox. ")).toBe("Red Fox");
    expect(normalizeKeyword('"snow"')).toBe("snow");
  });
  it("rejects malformed values", () => {
    expect(normalizeKeyword("")).toBe("");
    expect(normalizeKeyword("---")).toBe("");
    expect(normalizeKeyword(42)).toBe("");
    expect(normalizeKeyword(null)).toBe("");
    expect(normalizeKeyword("a".repeat(61))).toBe("");
    expect(normalizeKeyword("fox, wolf")).toBe("");
  });
  it("keeps Unicode letters", () => {
    expect(normalizeKeyword("café")).toBe("café");
    expect(normalizeKeyword("雪")).toBe("雪");
  });
});

describe("dedupeKeywords", () => {
  it("is case-insensitive and keeps the first spelling", () => {
    expect(dedupeKeywords(["Red Fox", "red fox", "RED FOX", "snow"])).toEqual(["Red Fox", "snow"]);
  });
  it("normalizes Unicode forms", () => {
    expect(dedupeKeywords(["cafe\u0301", "café"])).toHaveLength(1);
  });
});

describe("containsTerm", () => {
  it("matches whole words and phrases only", () => {
    expect(containsTerm("dog park", "dog")).toBe(true);
    expect(containsTerm("hotdog", "dog")).toBe(false);
    expect(containsTerm("Snowy Owl", "snowy owl")).toBe(true);
    expect(containsTerm("big snowy owl", "snowy owl")).toBe(true);
  });
});

describe("applyKeywordStyle", () => {
  it("single splits phrases and drops stop words", () => {
    expect(applyKeywordStyle(["red fox", "fox in snow", "winter"], "single")).toEqual([
      "red",
      "fox",
      "fox",
      "snow",
      "winter",
    ]);
  });
  it("double keeps exactly two-word phrases", () => {
    expect(applyKeywordStyle(["red fox", "fox", "red fox in snow", "winter forest"], "double")).toEqual([
      "red fox",
      "winter forest",
    ]);
  });
  it("auto keeps up to three words", () => {
    expect(applyKeywordStyle(["fox", "red fox", "red fox den", "red fox den entrance"], "auto")).toEqual([
      "fox",
      "red fox",
      "red fox den",
    ]);
  });
});

describe("processKeywords", () => {
  it("deduplicates case-insensitively and enforces the count", () => {
    const res = processKeywords(["Fox", "fox", "Snow", "Winter", "Forest"], { ...base, count: 3 });
    expect(res.keywords).toEqual(["Fox", "Snow", "Winter"]);
    expect(res.flags).toEqual([]);
  });

  it("removes excluded terms including phrases that contain them", () => {
    const res = processKeywords(["dog", "dog park", "hotdog", "grass"], { ...base, excludeTerms: ["Dog"] });
    expect(res.keywords).toEqual(["hotdog", "grass"]);
  });

  it("removes generic filler terms", () => {
    const res = processKeywords(["stock photo", "image", "fox", "Royalty Free"], base);
    expect(res.keywords).toEqual(["fox"]);
  });

  it("guarantees applicable include terms while respecting the count", () => {
    const res = processKeywords(["fox", "snow", "winter", "forest", "wildlife"], {
      ...base,
      count: 4,
      includeTerms: ["animal", "snow"],
    });
    // "snow" keeps its model position, "animal" is appended, others fill remaining slots.
    expect(res.keywords).toEqual(["fox", "snow", "winter", "animal"]);
    expect(res.keywords).toHaveLength(4);
  });

  it("does not add include terms Gemini marked as inapplicable and flags them", () => {
    const res = processKeywords(["fox", "snow"], {
      ...base,
      count: 2,
      includeTerms: ["beach"],
      inapplicableIncludeTerms: ["Beach"],
    });
    expect(res.keywords).toEqual(["fox", "snow"]);
    expect(res.flags.join(" ")).toMatch(/beach.*may not match/);
  });

  it("flags include terms that are also excluded", () => {
    const res = processKeywords(["fox"], { ...base, count: 1, includeTerms: ["snow"], excludeTerms: ["snow"] });
    expect(res.keywords).toEqual(["fox"]);
    expect(res.flags[0]).toMatch(/also excluded/);
  });

  it("never invents keywords when fewer than requested remain", () => {
    const res = processKeywords(["fox", "snow"], { ...base, count: 5 });
    expect(res.keywords).toEqual(["fox", "snow"]);
    expect(res.flags).toEqual([]);
  });

  it("applies style before counting", () => {
    const res = processKeywords(["red fox", "snowy winter forest"], { ...base, style: "single", count: 10 });
    expect(res.keywords).toEqual(["red", "fox", "snowy", "winter", "forest"]);
  });

  it("drops non-string and empty entries", () => {
    const res = processKeywords(["fox", "", "  ", 7, null, "snow"], { ...base, count: 2 });
    expect(res.keywords).toEqual(["fox", "snow"]);
  });
});

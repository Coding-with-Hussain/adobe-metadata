import { describe, expect, it } from "vitest";
import { filenameOnlyMetadata, filenameToTitle, filenameWords } from "@/lib/metadata/filename";
import { buildFilenameOnlyResult, normalizeModelOutput } from "@/lib/metadata/normalize";
import { modelOutputSchema } from "@/lib/metadata/schema";
import { DEFAULT_SETTINGS, generationSettingsSchema, parseTermList } from "@/lib/metadata/settings";
import { charCount } from "@/lib/metadata/text";
import { validateMetadata } from "@/lib/metadata/validate";

const settings = { ...DEFAULT_SETTINGS };

describe("filename helpers", () => {
  it("turns separators and camelCase into words and drops camera noise", () => {
    expect(filenameWords("IMG_1234_red-fox_inSnow (2).jpg")).toEqual(["red", "fox", "in", "Snow"]);
    expect(filenameToTitle("IMG_1234_red-fox_inSnow (2).jpg")).toBe("Red fox in snow");
  });
  it("keeps acronyms but lowercases shouted filenames", () => {
    expect(filenameToTitle("NYC_skyline_at_night.png")).toBe("NYC skyline at night");
    expect(filenameToTitle("SUNSET_BEACH.png")).toBe("Sunset beach");
  });
  it("keeps tokens like 4k", () => {
    expect(filenameToTitle("ocean-waves-4k.mp4")).toBe("Ocean waves 4k");
  });
  it("returns an empty title when nothing usable remains", () => {
    expect(filenameToTitle("DSC_0042.jpg")).toBe("");
    expect(filenameToTitle("12345.png")).toBe("");
  });
});

describe("filename-only mode", () => {
  it("derives deterministic metadata and flags the limitation", () => {
    const meta = filenameOnlyMetadata("red-fox-snow-forest.jpg", { ...settings, keywordStyle: "single" });
    expect(meta.title).toBe("Red fox snow forest");
    expect(meta.description).toBe("Red fox snow forest.");
    expect(meta.keywords).toEqual(["red", "fox", "snow", "forest"]);
    expect(meta.flags[0]).toMatch(/Filename-only/);
  });

  it("uses bigrams for double style", () => {
    const meta = filenameOnlyMetadata("red-fox-snow.jpg", { ...settings, keywordStyle: "double" });
    expect(meta.keywords).toEqual(["red fox", "fox snow"]);
  });

  it("applies include and exclude terms", () => {
    const meta = filenameOnlyMetadata("red-fox-snow.jpg", {
      ...settings,
      keywordStyle: "single",
      includeTerms: ["wildlife"],
      excludeTerms: ["snow"],
    });
    expect(meta.keywords).toEqual(["red", "fox", "wildlife"]);
  });

  it("filename-only takes precedence and stays title-from-filename when filename-as-title is also on", () => {
    const res = buildFilenameOnlyResult({
      assetId: "a1",
      filename: "red-fox.jpg",
      settings: { ...settings, filenameOnly: true, filenameAsTitle: true },
    });
    expect(res.source).toBe("filename");
    expect(res.title).toBe("Red fox");
  });

  it("returns empty fields plus a flag for unusable filenames", () => {
    const res = buildFilenameOnlyResult({ assetId: "a1", filename: "IMG_0001.jpg", settings });
    expect(res.title).toBe("");
    expect(res.keywords).toEqual([]);
    expect(res.reviewFlags.join(" ")).toMatch(/no usable words/);
  });
});

describe("modelOutputSchema", () => {
  it("accepts a valid response", () => {
    const parsed = modelOutputSchema.safeParse({
      title: "Red fox",
      description: "A red fox in snow.",
      keywords: ["fox"],
      category: "wildlife",
      reviewFlags: [],
      inapplicableIncludeTerms: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts missing optional fields", () => {
    expect(modelOutputSchema.safeParse({ title: "a", description: "b", keywords: ["c"] }).success).toBe(true);
  });

  it("rejects missing or wrong-typed fields", () => {
    expect(modelOutputSchema.safeParse({ description: "b", keywords: ["c"] }).success).toBe(false);
    expect(modelOutputSchema.safeParse({ title: 1, description: "b", keywords: ["c"] }).success).toBe(false);
    expect(modelOutputSchema.safeParse({ title: "a", description: "b", keywords: "c" }).success).toBe(false);
    expect(modelOutputSchema.safeParse({ title: "a", description: "b", keywords: [] }).success).toBe(false);
    expect(modelOutputSchema.safeParse({ title: "a", description: "b", keywords: [1] }).success).toBe(false);
  });
});

describe("normalizeModelOutput", () => {
  const output = {
    title: "  Red fox standing in a snow-covered forest during a quiet winter morning  ",
    description: "A red fox stands alert\nin deep snow.",
    keywords: ["red fox", "Red Fox", "snow", "stock photo", "winter forest", "wildlife"],
    category: "Wildlife",
    reviewFlags: ["Species could also be a kit fox."],
    inapplicableIncludeTerms: [],
  };

  it("preserves assetId and filename from the app and enforces limits", () => {
    const res = normalizeModelOutput(output, {
      assetId: "asset-1",
      filename: "my file.jpg",
      settings: { ...settings, titleMaxChars: 40, keywordCount: 3 },
    });
    expect(res.assetId).toBe("asset-1");
    expect(res.filename).toBe("my file.jpg");
    expect(charCount(res.title)).toBeLessThanOrEqual(40);
    expect(res.description).toBe("A red fox stands alert in deep snow.");
    expect(res.keywords).toEqual(["red fox", "snow", "winter forest"]);
    expect(res.category).toBe("wildlife");
    expect(res.reviewFlags).toContain("Species could also be a kit fox.");
    expect(res.source).toBe("gemini");
  });

  it("uses the filename-derived title when filename-as-title is on", () => {
    const res = normalizeModelOutput(output, {
      assetId: "a",
      filename: "arctic_fox_portrait.jpg",
      settings: { ...settings, filenameAsTitle: true },
    });
    expect(res.title).toBe("Arctic fox portrait");
    // Description still comes from Gemini.
    expect(res.description).toMatch(/red fox/);
  });

  it("falls back to the generated title and flags it when the filename is unusable", () => {
    const res = normalizeModelOutput(output, {
      assetId: "a",
      filename: "DSC_0001.jpg",
      settings: { ...settings, filenameAsTitle: true },
    });
    expect(res.title).toMatch(/^Red fox/);
    expect(res.reviewFlags.join(" ")).toMatch(/Filename has no usable words/);
  });

  it("applies prefix/suffix and still respects the final limit", () => {
    const res = normalizeModelOutput(output, {
      assetId: "a",
      filename: "x.jpg",
      settings: { ...settings, titleMaxChars: 30, titlePrefix: "Vector:", titleSuffix: "| 4K" },
    });
    expect(res.title.startsWith("Vector: ")).toBe(true);
    expect(res.title.endsWith(" | 4K")).toBe(true);
    expect(charCount(res.title)).toBeLessThanOrEqual(30);
  });
});

describe("validateMetadata", () => {
  it("reports errors for empty or over-limit fields", () => {
    const issues = validateMetadata(
      { title: "", description: "x".repeat(300), keywords: [] },
      { ...settings, descriptionMaxChars: 200 },
    );
    expect(issues.filter((i) => i.severity === "error").map((i) => i.field)).toEqual([
      "title",
      "description",
      "keywords",
    ]);
  });

  it("reports duplicate keywords as errors and excluded terms as warnings", () => {
    const issues = validateMetadata(
      { title: "Fox", description: "A fox.", keywords: ["Fox", "fox", "dog park"] },
      { ...settings, excludeTerms: ["dog"] },
    );
    expect(issues.find((i) => i.message.includes("duplicates"))?.severity).toBe("error");
    expect(issues.find((i) => i.message.includes("excluded"))?.severity).toBe("warning");
  });

  it("returns no issues for valid metadata at the keyword target", () => {
    expect(
      validateMetadata({ title: "Fox", description: "A fox.", keywords: ["fox"] }, { ...settings, keywordCount: 1 }),
    ).toEqual([]);
  });

  it("warns (without blocking) when the keyword count differs from the target", () => {
    const issues = validateMetadata({ title: "Fox", description: "A fox.", keywords: ["fox"] }, settings);
    expect(issues).toEqual([{ field: "keywords", severity: "warning", message: "1 keyword; your target is 30." }]);
  });
});

describe("settings", () => {
  it("defaults validate", () => {
    expect(generationSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
  it("rejects out-of-range values", () => {
    expect(generationSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, keywordCount: 0 }).success).toBe(false);
    expect(generationSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, keywordStyle: "triple" }).success).toBe(false);
  });
  it("parses term lists", () => {
    expect(parseTermList("fox, Fox,  snow\nwinter;;")).toEqual(["fox", "snow", "winter"]);
  });
});

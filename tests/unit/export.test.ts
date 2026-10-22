import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildCsv, buildExportReport, exportFilename, type ExportCandidate } from "@/lib/export/build";
import { escapeCsvField, guardFormula, isFormulaLike, toCsv } from "@/lib/export/csv";
import { ADOBE_STOCK_PROFILE, EXPORT_PROFILES, GENERIC_PROFILE, getProfile, type ExportRow } from "@/lib/export/profiles";

function parse(csv: string): string[][] {
  const res = Papa.parse<string[]>(csv.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  expect(res.errors).toEqual([]);
  return res.data;
}

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    assetId: "a1",
    filename: "fox.jpg",
    title: "Red fox in snow",
    description: "A red fox stands in snow.",
    keywords: ["red fox", "snow"],
    category: "wildlife",
    profileFields: {},
    ...overrides,
  };
}

function candidate(r: ExportRow | null, extra: Partial<ExportCandidate> = {}): ExportCandidate {
  return { assetId: r?.assetId ?? "missing", filename: r?.filename ?? "missing.jpg", row: r, issues: [], ...extra };
}

const opts = { keywordFormat: "semicolon" as const, formulaGuard: true, bom: false, now: new Date(2026, 9, 22) };

describe("escapeCsvField", () => {
  it("quotes only when needed and doubles quotes", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("cr\rhere")).toBe('"cr\rhere"');
    expect(escapeCsvField(" padded")).toBe('" padded"');
    expect(escapeCsvField("")).toBe("");
  });
});

describe("formula injection guard", () => {
  it.each(["=SUM(A1)", "+1", "-2+3", "@cmd", "  =1+1", "\t=1", "\r=1", "\u0001=1"])("guards %j", (v) => {
    expect(isFormulaLike(v)).toBe(true);
    expect(guardFormula(v)).toBe(`'${v}`);
  });
  it.each(["Red fox", "a=b", "fox-snow", "email@example.com", ""])("leaves %j alone", (v) => {
    expect(guardFormula(v)).toBe(v);
  });
  it("can be disabled", () => {
    expect(toCsv(["h"], [["=1"]], { formulaGuard: false })).toBe("h\r\n=1\r\n");
    expect(toCsv(["h"], [["=1"]])).toBe("h\r\n'=1\r\n");
  });
});

describe("toCsv round-trip", () => {
  it("survives commas, quotes, newlines, Unicode and empty values", () => {
    const tricky = [
      ["a,b", 'quote "x"', "line1\nline2", "crlf\r\nend", ""],
      ["日本語", "emoji 🦊", "café", "  spaced  ", "tab\tinside"],
    ];
    const csv = toCsv(["c1", "c2", "c3", "c4", "c5"], tricky, { formulaGuard: false });
    expect(parse(csv)).toEqual([["c1", "c2", "c3", "c4", "c5"], ...tricky]);
  });

  it("adds a BOM only when asked", () => {
    expect(toCsv(["h"], [], { bom: true }).startsWith("\uFEFF")).toBe(true);
    expect(toCsv(["h"], []).startsWith("\uFEFF")).toBe(false);
  });
});

describe("Generic profile", () => {
  it("produces the exact versioned layout", () => {
    const candidates = [
      candidate(row()),
      candidate(
        row({
          assetId: "a2",
          filename: "café, “quoted”.png",
          title: 'Fox "Vulpes" at dawn',
          description: "Line one\nline two",
          keywords: ["fox", "雪"],
          category: undefined,
        }),
      ),
      candidate(row({ assetId: "a3", filename: "f.jpg", title: "=HYPERLINK(evil)", keywords: ["-x"] })),
    ];
    const report = buildExportReport(candidates, GENERIC_PROFILE);
    const built = buildCsv(candidates, report, GENERIC_PROFILE, opts);
    expect(built.csv).toBe(
      [
        "filename,title,description,keywords,category",
        "fox.jpg,Red fox in snow,A red fox stands in snow.,red fox; snow,wildlife",
        '"café, “quoted”.png","Fox ""Vulpes"" at dawn","Line one\nline two",fox; 雪,',
        "f.jpg,'=HYPERLINK(evil),A red fox stands in snow.,'-x,wildlife",
        "",
      ].join("\r\n"),
    );
    expect(built.filename).toBe("metadatagen-generic-2026-10-22.csv");
    expect(built.rowCount).toBe(3);
    expect(parse(built.csv)[2][2]).toBe("Line one\nline two");
  });

  it.each([
    ["comma", "red fox, snow"],
    ["pipe", "red fox | snow"],
    ["json", '"[""red fox"",""snow""]"'],
  ] as const)("supports the %s keyword format", (format, expected) => {
    const c = [candidate(row())];
    const built = buildCsv(c, buildExportReport(c, GENERIC_PROFILE), GENERIC_PROFILE, { ...opts, keywordFormat: format });
    expect(built.csv.split("\r\n")[1]).toContain(expected);
  });
});

describe("Adobe Stock profile", () => {
  it("produces Adobe's header and comma-separated keywords", () => {
    const candidates = [
      candidate(row({ profileFields: { adobeCategory: "1", adobeReleases: "" } })),
      candidate(row({ assetId: "a2", filename: "b.jpg", keywords: ["one"], profileFields: {} })),
    ];
    const report = buildExportReport(candidates, ADOBE_STOCK_PROFILE);
    const built = buildCsv(candidates, report, ADOBE_STOCK_PROFILE, opts);
    expect(built.csv).toBe(
      [
        "Filename,Title,Keywords,Category,Releases",
        'fox.jpg,Red fox in snow,"red fox, snow",1,',
        "b.jpg,Red fox in snow,one,,",
        "",
      ].join("\r\n"),
    );
    expect(built.filename).toBe("metadatagen-adobe-stock-2026-10-22.csv");
  });

  it("never invents category or releases", () => {
    const c = [candidate(row({ category: "wildlife" }))];
    const built = buildCsv(c, buildExportReport(c, ADOBE_STOCK_PROFILE), ADOBE_STOCK_PROFILE, opts);
    expect(parse(built.csv)[1]).toEqual(["fox.jpg", "Red fox in snow", "red fox, snow", "", ""]);
  });

  it("validates keyword limit and category format", () => {
    const tooMany = row({ keywords: Array.from({ length: 51 }, (_, i) => `k${i}`) });
    expect(ADOBE_STOCK_PROFILE.validateRow(tooMany).some((i) => i.severity === "error")).toBe(true);
    const badCat = row({ profileFields: { adobeCategory: "animals" } });
    expect(ADOBE_STOCK_PROFILE.validateRow(badCat)[0].field).toBe("category");
    const longTitle = row({ title: "x".repeat(80) });
    expect(ADOBE_STOCK_PROFILE.validateRow(longTitle)[0].severity).toBe("warning");
  });
});

describe("export report", () => {
  it("lists invalid and missing rows instead of silently dropping them", () => {
    const candidates = [
      candidate(row()),
      candidate(row({ assetId: "bad", filename: "bad.jpg", title: "" })),
      candidate(null, { assetId: "q", filename: "queued.jpg", missingReason: "Still queued." }),
      candidate(row({ assetId: "edited", filename: "e.jpg" }), {
        issues: [{ field: "title", severity: "error", message: "Title is 80 characters; the limit is 70." }],
      }),
    ];
    const report = buildExportReport(candidates, GENERIC_PROFILE);
    expect(report.valid.map((r) => r.assetId)).toEqual(["a1"]);
    expect(report.invalid.map((r) => r.assetId)).toEqual(["bad", "edited"]);
    expect(report.missing).toEqual([{ assetId: "q", filename: "queued.jpg", reason: "Still queued." }]);

    const built = buildCsv(candidates, report, GENERIC_PROFILE, opts);
    expect(built.rowCount).toBe(1);
    expect(parse(built.csv)).toHaveLength(2);
  });

  it("warns when a destination's file limits are exceeded", () => {
    const many = Array.from({ length: 5001 }, (_, i) => candidate(row({ assetId: `a${i}`, filename: `f${i}.jpg` })));
    const built = buildCsv(many, buildExportReport(many, ADOBE_STOCK_PROFILE), ADOBE_STOCK_PROFILE, opts);
    expect(built.fileWarnings.join(" ")).toMatch(/at most 5000 rows/);
  });
});

describe("profile registry", () => {
  it("contains every PRD destination and keeps unverified ones disabled", () => {
    const names = EXPORT_PROFILES.map((p) => p.name);
    for (const n of ["Generic CSV", "Adobe Stock", "Vecteezy", "123RF", "Freepik", "Pond5", "Depositphotos", "Canva", "iStock"]) {
      expect(names).toContain(n);
    }
    for (const p of EXPORT_PROFILES.filter((x) => x.status === "unverified")) {
      expect(p.enabled).toBe(false);
      expect(() => buildCsv([], { profileId: p.id, valid: [], invalid: [], missing: [], warningCount: 0 }, p, opts)).toThrow();
    }
  });

  it("falls back to generic for unknown ids", () => {
    expect(getProfile("nope").id).toBe("generic");
  });

  it("builds dated filenames", () => {
    expect(exportFilename("generic", new Date(2026, 0, 5))).toBe("metadatagen-generic-2026-01-05.csv");
  });
});

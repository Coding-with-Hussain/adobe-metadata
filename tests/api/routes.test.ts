import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/metadata/settings";
import { FIXTURES } from "../support/fixtures";
import { apiError, createFakeClient } from "../support/fake-gemini";

const fake = { client: createFakeClient() };
const createGeminiClient = vi.fn((apiKey: string) => {
  void apiKey;
  return fake.client;
});

vi.mock("@/lib/gemini/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/provider")>();
  return { ...actual, createGeminiClient: (apiKey: string) => createGeminiClient(apiKey) };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: async () => {} };
});

const SECRET = "AIzaSyTESTKEY_do_not_leak_0123456789";

function form(fields: Record<string, string | Blob>, headers: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/api/metadata/generate", { method: "POST", body: fd, headers });
}

let ipCounter = 0;
function validFields(overrides: Record<string, string | Blob> = {}) {
  return {
    assetId: "asset_1",
    filename: "../../etc/red-fox.jpg",
    settings: JSON.stringify(DEFAULT_SETTINGS),
    file: new Blob([FIXTURES.jpeg], { type: "image/jpeg" }),
    derived: "",
    ...overrides,
  };
}
// A fresh client IP per request keeps the per-minute limiter out of unrelated tests.
const ip = () => ({ "x-forwarded-for": `10.0.0.${++ipCounter % 250}` });

async function generate(fields: Record<string, string | Blob>, headers = ip()) {
  const { POST } = await import("@/app/api/metadata/generate/route");
  const res = await POST(form(fields, headers));
  const text = await res.text();
  return { res, text, body: JSON.parse(text) };
}

beforeEach(() => {
  fake.client = createFakeClient();
  createGeminiClient.mockClear();
  vi.stubEnv("GEMINI_API_KEY", SECRET);
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GEMINI_ALLOWED_MODELS", "");
  vi.stubEnv("RATE_LIMIT_PER_MINUTE", "");
  vi.stubEnv("DAILY_REQUEST_CAP", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/metadata/generate", () => {
  it("returns normalized metadata and preserves app-owned ids", async () => {
    const { res, body, text } = await generate(validFields());
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ assetId: "asset_1", filename: "red-fox.jpg", source: "gemini" });
    expect(createGeminiClient).toHaveBeenCalledWith(SECRET);
    expect(text).not.toContain(SECRET);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not call Gemini in filename-only mode, even without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { res, body } = await generate(
      validFields({ settings: JSON.stringify({ ...DEFAULT_SETTINGS, filenameOnly: true }), file: new Blob([]) }),
    );
    expect(res.status).toBe(200);
    expect(body.result).toMatchObject({ title: "Red fox", source: "filename" });
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it("returns a helpful setup error when the key is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { res, body } = await generate(validFields());
    expect(res.status).toBe(503);
    expect(body.error).toMatchObject({ code: "not_configured", retryable: false });
    expect(body.error.message).toMatch(/GEMINI_API_KEY/);
  });

  it("rejects a model outside the allowlist", async () => {
    vi.stubEnv("GEMINI_MODEL", "gemini-unknown");
    const { body } = await generate(validFields());
    expect(body.error.code).toBe("model_unavailable");
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ assetId: "bad id!" }, 400],
    [{ settings: "{" }, 400],
    [{ settings: JSON.stringify({ ...DEFAULT_SETTINGS, keywordCount: 999 }) }, 400],
    [{ filename: "" }, 400],
    [{ file: new Blob([FIXTURES.jpeg], { type: "image/gif" }) }, 415],
    [{ file: new Blob([FIXTURES.png], { type: "image/jpeg" }) }, 415],
    [{ derived: "something" }, 400],
  ])("validates input %#", async (override, status) => {
    const { res, body } = await generate(validFields(override as Record<string, string | Blob>));
    expect(res.status).toBe(status);
    expect(body.ok).toBe(false);
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it("rejects oversized analysis payloads", async () => {
    vi.stubEnv("MAX_ANALYSIS_IMAGE_MB", "1");
    const big = new Uint8Array(1024 * 1024 + 10);
    big.set(FIXTURES.jpeg);
    const { res, body } = await generate(validFields({ file: new Blob([big], { type: "image/jpeg" }) }));
    expect(res.status).toBe(413);
    expect(body.error.code).toBe("payload_too_large");
  });

  it("maps provider rate limits to 429 with Retry-After and a safe message", async () => {
    fake.client = createFakeClient({
      generateContent: async () => {
        throw apiError(429, `quota hit for key ${SECRET}, retry in 9s`);
      },
    });
    const { res, body, text } = await generate(validFields());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(body.error).toMatchObject({ code: "rate_limited", retryable: true, retryAfterMs: 9000 });
    expect(text).not.toContain(SECRET);
  });

  it("maps invalid keys without leaking provider text", async () => {
    fake.client = createFakeClient({
      generateContent: async () => {
        throw apiError(400, `API key not valid: ${SECRET}`);
      },
    });
    const { res, body, text } = await generate(validFields());
    expect(res.status).toBe(502);
    expect(body.error.code).toBe("unauthorized");
    expect(text).not.toContain(SECRET);
    // Logs are redacted too.
    for (const spy of [console.error, console.warn] as unknown as { mock: { calls: unknown[][] } }[]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    }
  });

  it("enforces the per-client rate limit", async () => {
    vi.stubEnv("RATE_LIMIT_PER_MINUTE", "2");
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect((await generate(validFields(), headers)).res.status).toBe(200);
    expect((await generate(validFields(), headers)).res.status).toBe(200);
    const third = await generate(validFields(), headers);
    expect(third.res.status).toBe(429);
    expect(third.res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("GET /api/health", () => {
  it("reports configuration state and limits without secrets", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ status: "ok", gemini: { configured: true, model: "gemini-3.6-flash", modelError: null } });
    expect(body.limits.maxVideoBytes).toBeGreaterThan(0);
    expect(text).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toMatch(/apiKey|GEMINI_API_KEY/);
  });

  it("reports not configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { GET } = await import("@/app/api/health/route");
    const body = await (await GET()).json();
    expect(body.gemini.configured).toBe(false);
  });

  it("reflects configured limits", async () => {
    vi.stubEnv("MAX_VIDEO_MB", "20");
    const { GET } = await import("@/app/api/health/route");
    const body = await (await GET()).json();
    expect(body.limits.maxVideoBytes).toBe(20 * 1024 * 1024);
  });
});

describe("POST /api/gemini/test", () => {
  async function test(headers = ip()) {
    const { POST } = await import("@/app/api/gemini/test/route");
    const res = await POST(new Request("http://localhost/api/gemini/test", { method: "POST", headers }));
    const text = await res.text();
    return { res, text, body: JSON.parse(text) };
  }

  it("reports connected", async () => {
    const { body, text } = await test();
    expect(body).toMatchObject({ status: "connected", model: "gemini-3.6-flash" });
    expect(text).not.toContain(SECRET);
  });

  it("reports not configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const { body } = await test();
    expect(body.status).toBe("not_configured");
    expect(createGeminiClient).not.toHaveBeenCalled();
  });

  it("reports an unauthorized key safely", async () => {
    fake.client = createFakeClient({
      get: async () => {
        throw apiError(400, `API key not valid ${SECRET}`);
      },
    });
    const { body, text } = await test();
    expect(body).toMatchObject({ status: "error", code: "unauthorized" });
    expect(text).not.toContain(SECRET);
  });

  it("reports an unavailable model", async () => {
    fake.client = createFakeClient({
      get: async () => {
        throw apiError(404, "models/gemini-3.6-flash is not found");
      },
    });
    const { body } = await test();
    expect(body).toMatchObject({ status: "error", code: "model_unavailable" });
  });
});

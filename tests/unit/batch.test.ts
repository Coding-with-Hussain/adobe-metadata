import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "@/lib/config/limits";
import { DEFAULT_SETTINGS } from "@/lib/metadata/settings";
import type { MetadataResult, SafeError } from "@/lib/metadata/schema";
import { assetsReducer, countAssets, createAsset, displayStatus, isEdited, type Asset } from "@/lib/queue/assets";
import { ClientError, processAsset } from "@/lib/queue/process";
import { backoffDelay, BatchRunner, type RunnerHooks } from "@/lib/queue/runner";
import { FIXTURES } from "../support/fixtures";

const flush = () => new Promise((r) => setTimeout(r, 0));

function result(id: string, overrides: Partial<MetadataResult> = {}): MetadataResult {
  return {
    assetId: id,
    filename: `${id}.jpg`,
    title: "Red fox",
    description: "A red fox.",
    keywords: ["fox", "snow"],
    category: "wildlife",
    reviewFlags: [],
    source: "gemini",
    ...overrides,
  };
}

function makeRunner(execute: RunnerHooks<string, string>["execute"], options: Partial<{ concurrency: number; maxAttempts: number }> = {}) {
  const events: string[] = [];
  const hooks: RunnerHooks<string, string> = {
    execute,
    onStart: (id) => events.push(`start:${id}`),
    onStage: () => {},
    onRetry: (id, _r, attempt) => events.push(`retry:${id}:${attempt}`),
    onSuccess: (id, _r, res) => events.push(`ok:${id}:${res}`),
    onFailure: (id, _r, e) => events.push(`fail:${id}:${e.code}`),
    onCancel: (id) => events.push(`cancel:${id}`),
    onPause: (reason) => events.push(`pause:${reason}`),
  };
  const runner = new BatchRunner(hooks, {
    concurrency: options.concurrency ?? 2,
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: 1,
    maxDelayMs: 4,
    random: () => 0.5,
    sleep: async () => {},
  });
  return { runner, events };
}

const transient: SafeError = { code: "provider_unavailable", message: "x", retryable: true };
const permanent: SafeError = { code: "invalid_input", message: "x", retryable: false };

describe("backoffDelay", () => {
  it("grows exponentially, is capped and jittered", () => {
    expect(backoffDelay(1, 1000, 10_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 10_000, () => 1)).toBe(4000);
    expect(backoffDelay(10, 1000, 10_000, () => 1)).toBe(10_000);
    expect(backoffDelay(3, 1000, 10_000, () => 0.25)).toBe(1000);
  });
});

describe("BatchRunner", () => {
  it("respects the concurrency limit", async () => {
    let running = 0;
    let peak = 0;
    const { runner, events } = makeRunner(async (id) => {
      running++;
      peak = Math.max(peak, running);
      await flush();
      running--;
      return id;
    });
    runner.enqueue(["a", "b", "c", "d", "e"]);
    for (let i = 0; i < 20; i++) await flush();
    expect(peak).toBe(2);
    expect(events.filter((e) => e.startsWith("ok:"))).toHaveLength(5);
  });

  it("isolates failures to the affected item", async () => {
    const { runner, events } = makeRunner(async (id) => {
      if (id === "bad") throw permanent;
      return id;
    });
    runner.enqueue(["a", "bad", "c"]);
    for (let i = 0; i < 10; i++) await flush();
    expect(events).toContain("fail:bad:invalid_input");
    expect(events).toContain("ok:a:a");
    expect(events).toContain("ok:c:c");
  });

  it("retries transient errors up to maxAttempts, then fails", async () => {
    const execute = vi.fn(async () => {
      throw transient;
    });
    const { runner, events } = makeRunner(execute, { maxAttempts: 3 });
    runner.enqueue(["a"]);
    for (let i = 0; i < 10; i++) await flush();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["start:a", "retry:a:1", "retry:a:2", "fail:a:provider_unavailable"]);
  });

  it("does not retry permanent errors", async () => {
    const execute = vi.fn(async () => {
      throw permanent;
    });
    const { runner } = makeRunner(execute);
    runner.enqueue(["a"]);
    for (let i = 0; i < 5; i++) await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("succeeds after a transient failure", async () => {
    let calls = 0;
    const { runner, events } = makeRunner(async (id) => {
      if (++calls === 1) throw transient;
      return id;
    });
    runner.enqueue(["a"]);
    for (let i = 0; i < 5; i++) await flush();
    expect(events).toEqual(["start:a", "retry:a:1", "ok:a:a"]);
  });

  it("pauses scheduling on global configuration errors", async () => {
    const { runner, events } = makeRunner(
      async () => {
        throw { code: "not_configured", message: "x", retryable: false } satisfies SafeError;
      },
      { concurrency: 1 },
    );
    runner.enqueue(["a", "b", "c"]);
    for (let i = 0; i < 5; i++) await flush();
    expect(events).toEqual(["start:a", "fail:a:not_configured", "pause:not_configured"]);
    expect(runner.pendingIds).toEqual(["b", "c"]);
    expect(runner.paused).toBe("not_configured");
  });

  it("can be paused (offline) and resumed", async () => {
    const { runner, events } = makeRunner(async (id) => id, { concurrency: 1 });
    runner.pause("offline");
    runner.enqueue(["a"]);
    await flush();
    expect(events).toEqual(["pause:offline"]);
    runner.resume();
    for (let i = 0; i < 5; i++) await flush();
    expect(events).toContain("ok:a:a");
  });

  it("cancels queued and in-flight items and ignores late results", async () => {
    let release: (v: string) => void = () => {};
    const { runner, events } = makeRunner(
      (id) =>
        id === "slow"
          ? new Promise<string>((r) => {
              release = r;
            })
          : Promise.resolve(id),
      { concurrency: 1 },
    );
    runner.enqueue(["slow", "queued"]);
    await flush();
    runner.cancel("queued");
    runner.cancel("slow");
    release("late");
    for (let i = 0; i < 5; i++) await flush();
    expect(events).toEqual(["start:slow", "cancel:queued", "cancel:slow"]);
  });

  it("ignores duplicate enqueues of the same id", async () => {
    const execute = vi.fn(async (id: string) => {
      await flush();
      return id;
    });
    const { runner } = makeRunner(execute, { concurrency: 1 });
    runner.enqueue(["a", "a"]);
    runner.enqueue(["a"]);
    for (let i = 0; i < 10; i++) await flush();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function asset(id: string): Asset {
  return createAsset({
    id,
    file: new File([FIXTURES.jpeg], `${id}.jpg`, { type: "image/jpeg" }),
    format: { label: "JPEG", extensions: [".jpg"], mimeTypes: ["image/jpeg"], canonicalMime: "image/jpeg", kind: "image" },
    previewUrl: null,
    durationSec: null,
    fingerprint: null,
  });
}

describe("assetsReducer", () => {
  it("never duplicates rows and ignores stale or repeated results", () => {
    let s = assetsReducer([], { type: "add", assets: [asset("a"), asset("b")] });
    s = assetsReducer(s, { type: "add", assets: [asset("a")] });
    expect(s).toHaveLength(2);

    s = assetsReducer(s, { type: "queue", ids: ["a"] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 1 });
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("a") });
    const afterFirst = s;
    // Repeated delivery of the same result is a no-op.
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("a", { title: "Other" }) });
    expect(s).toBe(afterFirst);

    // Regenerate: a newer run wins, an older late result is ignored.
    s = assetsReducer(s, { type: "queue", ids: ["a"] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 2 });
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("a", { title: "Stale" }) });
    expect(s.find((x) => x.id === "a")!.metadata!.title).toBe("Red fox");
    s = assetsReducer(s, { type: "success", id: "a", runId: 2, result: result("a", { title: "Fresh" }) });
    expect(s.find((x) => x.id === "a")!.metadata!.title).toBe("Fresh");
    expect(s).toHaveLength(2);
  });

  it("rejects a result that belongs to another asset", () => {
    let s = assetsReducer([], { type: "add", assets: [asset("a")] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 1 });
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("b") });
    expect(s[0].metadata).toBeUndefined();
  });

  it("keeps previous metadata when a regenerate fails", () => {
    let s = assetsReducer([], { type: "add", assets: [asset("a")] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 1 });
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("a") });
    s = assetsReducer(s, { type: "edit", id: "a", patch: { title: "Edited" } });
    s = assetsReducer(s, { type: "queue", ids: ["a"] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 2 });
    s = assetsReducer(s, { type: "failure", id: "a", runId: 2, error: permanent });
    expect(s[0].status).toBe("completed");
    expect(s[0].metadata!.title).toBe("Edited");
    expect(s[0].error?.code).toBe("invalid_input");
  });

  it("tracks edits, review status and counts", () => {
    let s = assetsReducer([], { type: "add", assets: [asset("a"), asset("b")] });
    s = assetsReducer(s, { type: "start", id: "a", runId: 1 });
    s = assetsReducer(s, { type: "success", id: "a", runId: 1, result: result("a", { reviewFlags: ["check species"] }) });
    expect(displayStatus(s[0], DEFAULT_SETTINGS)).toBe("needs_review");
    s = assetsReducer(s, { type: "acknowledge", id: "a" });
    expect(displayStatus(s[0], DEFAULT_SETTINGS)).toBe("ready");
    s = assetsReducer(s, { type: "edit", id: "a", patch: { title: "" } });
    expect(isEdited(s[0])).toBe(true);
    expect(displayStatus(s[0], DEFAULT_SETTINGS)).toBe("needs_review");
    s = assetsReducer(s, { type: "revert", id: "a" });
    expect(isEdited(s[0])).toBe(false);
    expect(countAssets(s, DEFAULT_SETTINGS)).toMatchObject({ total: 2, ready: 1, idle: 1 });
  });

  it("cancel returns queued items to cancelled without touching completed ones", () => {
    let s = assetsReducer([], { type: "add", assets: [asset("a")] });
    s = assetsReducer(s, { type: "queue", ids: ["a"] });
    s = assetsReducer(s, { type: "cancel", id: "a" });
    expect(s[0].status).toBe("cancelled");
  });
});

describe("processAsset", () => {
  const base = {
    asset: { id: "a1", name: "red-fox.jpg", file: new File([FIXTURES.jpeg], "red-fox.jpg"), kind: "image" as const, mimeType: "image/jpeg" },
    settings: DEFAULT_SETTINGS,
    limits: DEFAULT_LIMITS,
    signal: new AbortController().signal,
    onStage: () => {},
  };
  const prepare = vi.fn(async (a: { file: File; mimeType: string }) => ({ blob: a.file, mimeType: a.mimeType, derived: "" as const }));

  it("never calls the API in filename-only mode", async () => {
    const fetchMock = vi.fn();
    const res = await processAsset(
      { ...base, settings: { ...DEFAULT_SETTINGS, filenameOnly: true } },
      { fetch: fetchMock as unknown as typeof fetch, prepare },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ assetId: "a1", title: "Red fox", source: "filename" });
  });

  it("posts the asset and validates the response", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: result("a1") }));
    const res = await processAsset(base, { fetch: fetchMock as unknown as typeof fetch, prepare });
    expect(res.title).toBe("Red fox");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/metadata/generate");
    const fd = init.body as FormData;
    expect(fd.get("assetId")).toBe("a1");
    expect(fd.get("filename")).toBe("red-fox.jpg");
  });

  it("rejects a response for a different asset", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: result("other") }));
    await expect(processAsset(base, { fetch: fetchMock as unknown as typeof fetch, prepare })).rejects.toMatchObject({
      code: "malformed_output",
    });
  });

  it("surfaces server errors with their retry semantics", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { ok: false, error: { code: "rate_limited", message: "slow down", retryable: true } },
        { status: 429, headers: { "Retry-After": "3" } },
      ),
    );
    await expect(processAsset(base, { fetch: fetchMock as unknown as typeof fetch, prepare })).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterMs: 3000,
    });
  });

  it("maps network failures and non-JSON responses to retryable errors", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(processAsset(base, { fetch: offline as unknown as typeof fetch, prepare })).rejects.toBeInstanceOf(ClientError);
    await expect(processAsset(base, { fetch: offline as unknown as typeof fetch, prepare })).rejects.toMatchObject({
      code: "network",
      retryable: true,
    });
    const html = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(processAsset(base, { fetch: html as unknown as typeof fetch, prepare })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

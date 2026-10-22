import type { ErrorCode, SafeError } from "@/lib/metadata/schema";

/**
 * Framework-agnostic batch runner:
 * - bounded concurrency,
 * - retries only for retryable errors, with capped exponential backoff and
 *   full jitter (honouring a server-provided retry-after hint),
 * - per-item cancellation through AbortController,
 * - pauses scheduling on errors that will affect every item (missing or
 *   invalid credentials, unavailable model, exhausted quota) and when the
 *   caller pauses it (e.g. the browser went offline).
 *
 * Every attempt sequence gets a `runId`; consumers use it to ignore late
 * results so a retry or regenerate never produces duplicate rows.
 */

export const GLOBAL_ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  "not_configured",
  "unauthorized",
  "model_unavailable",
  "quota_exceeded",
]);

export interface ExecuteContext<S> {
  signal: AbortSignal;
  attempt: number;
  runId: number;
  onStage: (stage: S) => void;
}

export interface RunnerHooks<R, S> {
  execute(id: string, ctx: ExecuteContext<S>): Promise<R>;
  onStart(id: string, runId: number): void;
  onStage(id: string, runId: number, stage: S): void;
  onRetry(id: string, runId: number, attempt: number, error: SafeError, delayMs: number): void;
  onSuccess(id: string, runId: number, result: R): void;
  onFailure(id: string, runId: number, error: SafeError): void;
  onCancel(id: string): void;
  onPause?(reason: string, error?: SafeError): void;
  onIdle?(): void;
}

export interface RunnerOptions {
  concurrency: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  random?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function backoffDelay(attempt: number, baseMs: number, capMs: number, random: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * exp);
}

export function toSafeError(err: unknown): SafeError {
  if (typeof err === "object" && err !== null && "code" in err && "message" in err && "retryable" in err) {
    const e = err as SafeError;
    return { code: e.code, message: e.message, retryable: e.retryable, retryAfterMs: e.retryAfterMs };
  }
  return { code: "internal", message: "Unexpected error while processing this file.", retryable: false };
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export class BatchRunner<R, S = string> {
  private pending: string[] = [];
  private readonly active = new Map<string, AbortController>();
  private pausedReason: string | null = null;
  private runCounter = 0;
  private options: Required<RunnerOptions>;

  constructor(
    private readonly hooks: RunnerHooks<R, S>,
    options: RunnerOptions,
  ) {
    this.options = { random: Math.random, sleep: abortableSleep, ...options };
  }

  get pendingIds(): readonly string[] {
    return this.pending;
  }
  get activeIds(): string[] {
    return [...this.active.keys()];
  }
  get paused(): string | null {
    return this.pausedReason;
  }

  setConcurrency(n: number) {
    this.options.concurrency = Math.max(1, Math.floor(n));
    this.pump();
  }

  /** Queue ids for processing. Ids already queued or running are ignored. */
  enqueue(ids: string[]) {
    for (const id of ids) {
      if (!this.pending.includes(id) && !this.active.has(id)) this.pending.push(id);
    }
    this.pump();
  }

  /** Cancel a queued or running item. A running request is aborted and its result ignored. */
  cancel(id: string) {
    const idx = this.pending.indexOf(id);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      this.hooks.onCancel(id);
      return;
    }
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      this.active.delete(id);
      this.hooks.onCancel(id);
      this.pump();
    }
  }

  cancelAll() {
    for (const id of [...this.pending]) this.cancel(id);
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  pause(reason: string, error?: SafeError) {
    if (this.pausedReason === null) {
      this.pausedReason = reason;
      this.hooks.onPause?.(reason, error);
    }
  }

  resume() {
    this.pausedReason = null;
    this.pump();
  }

  private pump() {
    while (this.pausedReason === null && this.active.size < this.options.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      void this.run(id);
    }
    if (this.active.size === 0 && this.pending.length === 0) this.hooks.onIdle?.();
  }

  private async run(id: string) {
    const controller = new AbortController();
    const { signal } = controller;
    const runId = ++this.runCounter;
    this.active.set(id, controller);
    this.hooks.onStart(id, runId);

    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const result = await this.hooks.execute(id, {
            signal,
            attempt,
            runId,
            onStage: (stage) => {
              if (!signal.aborted) this.hooks.onStage(id, runId, stage);
            },
          });
          if (!signal.aborted) this.hooks.onSuccess(id, runId, result);
          return;
        } catch (err) {
          if (signal.aborted) return;
          const error = toSafeError(err);
          if (GLOBAL_ERROR_CODES.has(error.code)) {
            this.hooks.onFailure(id, runId, error);
            this.pause(error.code, error);
            return;
          }
          if (error.retryable && attempt < this.options.maxAttempts) {
            const delay = Math.max(
              error.retryAfterMs ?? 0,
              backoffDelay(attempt, this.options.baseDelayMs, this.options.maxDelayMs, this.options.random),
            );
            this.hooks.onRetry(id, runId, attempt, error, delay);
            await this.options.sleep(delay, signal);
            if (signal.aborted) return;
            continue;
          }
          this.hooks.onFailure(id, runId, error);
          return;
        }
      }
    } finally {
      if (this.active.get(id) === controller) this.active.delete(id);
      this.pump();
    }
  }
}

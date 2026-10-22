import "server-only";
import { createPartFromBase64, createPartFromUri, FileState, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Content, File as GeminiFile, GenerateContentConfig, GenerateContentResponse, Part } from "@google/genai";
import type { ThinkingLevelSetting } from "@/lib/config/server-env";
import { normalizeModelOutput } from "@/lib/metadata/normalize";
import { MODEL_OUTPUT_JSON_SCHEMA, modelOutputSchema, type MetadataResult, type ModelOutput } from "@/lib/metadata/schema";
import type { GenerationSettings } from "@/lib/metadata/settings";
import { AppError, mapProviderError, SAFE_MESSAGES } from "./errors";
import { buildCorrectionPrompt, buildUserPrompt, SYSTEM_INSTRUCTION } from "./prompt";
import { logServer } from "@/lib/server/log";

/**
 * Provider adapter: the only module that knows how Gemini is called.
 * Uses the official `@google/genai` SDK (`ai.models.generateContent`,
 * `ai.files.*`). Images and small videos are sent inline; larger videos go
 * through the Files API and are deleted afterwards.
 */

/** Subset of the SDK client used here, so tests can inject a fake. */
export interface GeminiClient {
  models: {
    generateContent(params: { model: string; contents: Content[]; config?: GenerateContentConfig }): Promise<
      Pick<GenerateContentResponse, "text" | "candidates" | "promptFeedback">
    >;
    get(params: { model: string; config?: { abortSignal?: AbortSignal; httpOptions?: { timeout?: number } } }): Promise<{
      name?: string;
      displayName?: string;
    }>;
  };
  files: {
    upload(params: { file: Blob; config?: { mimeType?: string; displayName?: string; abortSignal?: AbortSignal } }): Promise<GeminiFile>;
    get(params: { name: string; config?: { abortSignal?: AbortSignal } }): Promise<GeminiFile>;
    delete(params: { name: string }): Promise<unknown>;
  };
}

export function createGeminiClient(apiKey: string): GeminiClient {
  return new GoogleGenAI({ apiKey }) as unknown as GeminiClient;
}

const THINKING_MAP: Record<ThinkingLevelSetting, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const BLOCK_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export type Stage = "uploading" | "processing" | "analyzing" | "validating";

export interface GenerateInput {
  client: GeminiClient;
  model: string;
  thinkingLevel: ThinkingLevelSetting | null;
  timeoutMs: number;
  media: { bytes: Uint8Array; mimeType: string; kind: "image" | "video" };
  inlineVideoMaxBytes: number;
  assetId: string;
  filename: string;
  settings: GenerationSettings;
  /** Hints about how the browser derived the analysis payload. */
  derived?: { fromSvg?: boolean; silhouette?: boolean };
  signal?: AbortSignal;
  /** Polling interval for Files API processing (ms). */
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError("cancelled", SAFE_MESSAGES.cancelled));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AppError("cancelled", SAFE_MESSAGES.cancelled));
      },
      { once: true },
    );
  });
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

async function waitForActive(input: GenerateInput, file: GeminiFile, deadline: number): Promise<GeminiFile> {
  const sleep = input.sleep ?? defaultSleep;
  let current = file;
  while (current.state === FileState.PROCESSING || current.state === undefined || current.state === FileState.STATE_UNSPECIFIED) {
    if (Date.now() > deadline) throw new AppError("timeout", "Gemini took too long to process the video.", { retryable: true });
    await sleep(input.pollIntervalMs ?? 2000, input.signal);
    current = await input.client.files.get({ name: file.name!, config: { abortSignal: input.signal } });
  }
  if (current.state !== FileState.ACTIVE) {
    throw new AppError("media_processing_failed", SAFE_MESSAGES.media_processing_failed);
  }
  return current;
}

/** Parse and schema-validate the model's JSON. Returns a problem description on failure. */
export function parseModelJson(text: string | undefined): { ok: true; value: ModelOutput } | { ok: false; problem: string } {
  if (!text || !text.trim()) return { ok: false, problem: "the reply was empty" };
  let data: unknown;
  try {
    // Tolerate a fenced code block even though JSON mode should not produce one.
    const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    data = JSON.parse(unfenced);
  } catch {
    return { ok: false, problem: "the reply was not parseable JSON" };
  }
  const parsed = modelOutputSchema.safeParse(data);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "root"))].slice(0, 5);
    return { ok: false, problem: `invalid or missing fields: ${fields.join(", ")}` };
  }
  return { ok: true, value: parsed.data };
}

function checkBlocked(response: Pick<GenerateContentResponse, "candidates" | "promptFeedback">): void {
  if (response.promptFeedback?.blockReason) throw new AppError("blocked", SAFE_MESSAGES.blocked);
  const reason = response.candidates?.[0]?.finishReason;
  if (reason && BLOCK_FINISH_REASONS.has(String(reason))) throw new AppError("blocked", SAFE_MESSAGES.blocked);
}

export async function generateMetadata(
  input: GenerateInput,
  onStage: (stage: Stage) => void = () => {},
): Promise<MetadataResult> {
  const { client, media } = input;
  const deadline = Date.now() + input.timeoutMs;
  let uploaded: GeminiFile | null = null;

  try {
    let mediaPart: Part;
    if (media.kind === "video" && media.bytes.byteLength > input.inlineVideoMaxBytes) {
      onStage("uploading");
      uploaded = await client.files.upload({
        file: new Blob([media.bytes as BlobPart], { type: media.mimeType }),
        // No user filename is sent as the display name.
        config: { mimeType: media.mimeType, displayName: "metadatagen-asset", abortSignal: input.signal },
      });
      onStage("processing");
      const active = await waitForActive(input, uploaded, deadline);
      mediaPart = createPartFromUri(active.uri!, active.mimeType ?? media.mimeType);
    } else {
      mediaPart = createPartFromBase64(toBase64(media.bytes), media.mimeType);
    }

    const userTurn: Content = {
      role: "user",
      parts: [
        mediaPart,
        {
          text: buildUserPrompt(input.settings, {
            filename: input.filename,
            mediaKind: media.kind,
            fromSvg: input.derived?.fromSvg,
            silhouette: input.derived?.silhouette,
          }),
        },
      ],
    };

    const config: GenerateContentConfig = {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseJsonSchema: MODEL_OUTPUT_JSON_SCHEMA,
      abortSignal: input.signal,
      httpOptions: { timeout: Math.max(1000, deadline - Date.now()) },
      ...(input.thinkingLevel ? { thinkingConfig: { thinkingLevel: THINKING_MAP[input.thinkingLevel] } } : {}),
    };

    onStage("analyzing");
    const first = await client.models.generateContent({ model: input.model, contents: [userTurn], config });
    checkBlocked(first);
    let parsed = parseModelJson(first.text);

    if (!parsed.ok) {
      // One corrective retry for recoverable malformed output.
      logServer("warn", "gemini.malformed_output", { assetId: input.assetId, attempt: 1, problem: parsed.problem });
      const correction = await client.models.generateContent({
        model: input.model,
        contents: [
          userTurn,
          { role: "model", parts: [{ text: (first.text ?? "").slice(0, 4000) }] },
          { role: "user", parts: [{ text: buildCorrectionPrompt(parsed.problem) }] },
        ],
        config: { ...config, httpOptions: { timeout: Math.max(1000, deadline - Date.now()) } },
      });
      checkBlocked(correction);
      parsed = parseModelJson(correction.text);
      if (!parsed.ok) {
        logServer("warn", "gemini.malformed_output", { assetId: input.assetId, attempt: 2, problem: parsed.problem });
        throw new AppError("malformed_output", SAFE_MESSAGES.malformed_output, { retryable: false });
      }
    }

    onStage("validating");
    return normalizeModelOutput(parsed.value, {
      assetId: input.assetId,
      filename: input.filename,
      settings: input.settings,
    });
  } catch (err) {
    const mapped = mapProviderError(err);
    if (!(err instanceof AppError)) {
      logServer("error", "gemini.request_failed", { assetId: input.assetId, code: mapped.code, detail: err });
    }
    throw mapped;
  } finally {
    if (uploaded?.name) {
      const name = uploaded.name;
      // Best-effort cleanup; Gemini also deletes uploaded files automatically after 48 hours.
      await client.files.delete({ name }).catch((err) => {
        logServer("warn", "gemini.file_cleanup_failed", { detail: err });
      });
    }
  }
}

/** Lightweight connection test: fetches the configured model's metadata (no tokens used). */
export async function testConnection(client: GeminiClient, model: string, timeoutMs = 10_000) {
  try {
    const info = await client.models.get({ model, config: { httpOptions: { timeout: timeoutMs } } });
    return { ok: true as const, displayName: typeof info.displayName === "string" ? info.displayName : undefined };
  } catch (err) {
    const mapped = mapProviderError(err);
    logServer("warn", "gemini.connection_test_failed", { code: mapped.code, detail: err });
    return { ok: false as const, error: mapped };
  }
}

import { vi } from "vitest";
import type { GeminiClient } from "@/lib/gemini/provider";

export const VALID_OUTPUT = {
  title: "Red fox standing in a snow-covered forest",
  description: "Red fox standing in snow in a quiet winter forest.",
  keywords: ["red fox", "wild fox", "snow", "winter forest", "wildlife", "animal portrait"],
  category: "wildlife",
  reviewFlags: [],
  inapplicableIncludeTerms: [],
};

export function textResponse(text: string) {
  return { text, candidates: [{ finishReason: "STOP" }], promptFeedback: undefined } as never;
}

export function apiError(status: number, message: string) {
  return Object.assign(new Error(message), { name: "ApiError", status });
}

export function createFakeClient(overrides: Partial<{
  generateContent: GeminiClient["models"]["generateContent"];
  get: GeminiClient["models"]["get"];
  upload: GeminiClient["files"]["upload"];
  fileGet: GeminiClient["files"]["get"];
  fileDelete: GeminiClient["files"]["delete"];
}> = {}) {
  const client = {
    models: {
      generateContent: vi.fn(overrides.generateContent ?? (async () => textResponse(JSON.stringify(VALID_OUTPUT)))),
      get: vi.fn(overrides.get ?? (async () => ({ name: "models/test", displayName: "Test Model" }))),
    },
    files: {
      upload: vi.fn(
        overrides.upload ??
          (async () => ({ name: "files/abc", uri: "https://example.invalid/files/abc", mimeType: "video/mp4", state: "PROCESSING" })),
      ),
      get: vi.fn(
        overrides.fileGet ??
          (async () => ({ name: "files/abc", uri: "https://example.invalid/files/abc", mimeType: "video/mp4", state: "ACTIVE" })),
      ),
      delete: vi.fn(overrides.fileDelete ?? (async () => ({}))),
    },
  };
  return client as typeof client & GeminiClient;
}

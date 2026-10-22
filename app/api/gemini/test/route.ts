import { readServerConfig } from "@/lib/config/server-env";
import { SAFE_MESSAGES } from "@/lib/gemini/errors";
import { createGeminiClient, testConnection } from "@/lib/gemini/provider";
import { clientKey, RateLimiter } from "@/lib/server/rate-limit";

export type ConnectionStatus = "connected" | "not_configured" | "error";

export interface ConnectionTestResponse {
  status: ConnectionStatus;
  model: string;
  message: string;
  code?: string;
}

// Connection tests are cheap but still hit Google; keep them modest.
const limiter = new RateLimiter(10, 0);

/** Validates the server-side key and model with a token-free model lookup. Returns only safe fields. */
export async function POST(request: Request): Promise<Response> {
  const config = readServerConfig();
  const headers = { "Cache-Control": "no-store" };
  const reply = (body: ConnectionTestResponse, status = 200) => Response.json(body, { status, headers });

  if (!limiter.check(clientKey(request.headers)).allowed) {
    return reply({ status: "error", model: config.model, code: "rate_limited", message: "Too many connection tests. Wait a minute." }, 429);
  }
  if (!config.apiKey) {
    return reply({ status: "not_configured", model: config.model, code: "not_configured", message: SAFE_MESSAGES.not_configured });
  }
  if (config.modelError) {
    return reply({ status: "error", model: config.model, code: "model_unavailable", message: config.modelError });
  }

  const result = await testConnection(createGeminiClient(config.apiKey), config.model);
  if (result.ok) {
    return reply({
      status: "connected",
      model: config.model,
      message: `Connected to ${result.displayName ?? config.model}.`,
    });
  }
  return reply({ status: "error", model: config.model, code: result.error.code, message: result.error.message });
}

import { connection } from "next/server";
import { readServerConfig } from "@/lib/config/server-env";

export interface HealthResponse {
  status: "ok";
  gemini: {
    /** True when an API key is present. Says nothing about whether it is valid; use POST /api/gemini/test. */
    configured: boolean;
    model: string;
    modelError: string | null;
  };
  limits: ReturnType<typeof readServerConfig>["limits"];
}

/** App status and public limits. Never returns secrets. */
export async function GET(): Promise<Response> {
  // Read configuration per request rather than baking it in at build time.
  await connection();
  const config = readServerConfig();
  const body: HealthResponse = {
    status: "ok",
    gemini: { configured: config.apiKey !== null, model: config.model, modelError: config.modelError },
    limits: config.limits,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

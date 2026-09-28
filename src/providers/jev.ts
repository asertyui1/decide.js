import { HttpProvider } from "./http.js";

export interface JevConfig {
  /** Defaults to the JEV_API_KEY environment variable. */
  apiKey?: string;
  /**
   * Full endpoint URL. Defaults to $JEV_BASE_URL or the public gateway.
   * Override it if your provider uses a different path/version.
   */
  url?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Preset for TypeSafe AI's Jev "System 1" decision model and any gateway that
 * exposes it (e.g. AI Gateways). Speaks the Decide Wire Protocol.
 *
 * Configuration via environment variables:
 *   JEV_API_KEY   – API key (provider is unavailable until set)
 *   JEV_BASE_URL  – endpoint URL
 *   JEV_MODEL     – model id (default: "jev")
 */
export function createJevProvider(config: JevConfig = {}): HttpProvider {
  const apiKey = config.apiKey ?? process.env.JEV_API_KEY ?? undefined;
  const url =
    config.url ??
    process.env.JEV_BASE_URL ??
    "https://api.typesafe.ai/v1/decide";
  const model = config.model ?? process.env.JEV_MODEL ?? "jev";

  return new HttpProvider({
    name: "jev",
    url,
    apiKey,
    model,
    location: "cloud",
    requiresApiKey: true,
    timeoutMs: config.timeoutMs ?? 15000,
    costPerCallUsd: 0,
    notes:
      "TypeSafe AI Jev (System 1 decision model) via JSON gateway. Set JEV_API_KEY. " +
      "Output-token pricing is often free; set actual cost per gateway you use.",
  });
}

/**
 * Preset for a self-hosted OpenAI-compatible decision endpoint serving open
 * weights (Laya, von, tev1, Kev...). Defaults to localhost; override with
 * DECIDE_SELFHOST_URL and DECIDE_SELFHOST_MODEL.
 */
export function createSelfHostedProvider(config: JevConfig = {}): HttpProvider {
  const explicitUrl = config.url ?? process.env.DECIDE_SELFHOST_URL;
  const url = explicitUrl ?? "http://localhost:8787/v1/decide";
  const model = config.model ?? process.env.DECIDE_SELFHOST_MODEL ?? "laya";
  const apiKey = config.apiKey ?? process.env.DECIDE_SELFHOST_KEY ?? undefined;

  return new HttpProvider({
    name: "selfhosted",
    url,
    apiKey,
    model,
    location: "local",
    requiresApiKey: false,
    timeoutMs: config.timeoutMs ?? 30000,
    costPerCallUsd: 0,
    notes: "Self-hosted open decision weights (Laya/von/tev1...). Set DECIDE_SELFHOST_URL.",
    // Only "ready" when a server is actually configured; the localhost
    // default is an offline placeholder, not something we should probe.
    available: () => Boolean(explicitUrl),
  });
}

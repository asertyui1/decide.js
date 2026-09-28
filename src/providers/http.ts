import type {
  DecisionProvider,
  DecisionRequest,
  ProviderResult,
  ProviderCapabilities,
} from "../types.js";
import { ProviderError } from "../errors.js";

export interface HttpProviderConfig {
  name: string;
  url: string;
  apiKey?: string;
  model?: string;
  location?: ProviderCapabilities["location"];
  requiresApiKey?: boolean;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Extra fields merged into every request body. */
  extraBody?: Record<string, unknown>;
  costPerCallUsd?: number;
  notes?: string;
  /** Custom availability predicate; defaults to "key present when required". */
  available?: () => boolean;
}

/**
 * Universal HTTP adapter for the Decide Wire Protocol.
 *
 * Request:  POST `url` with the serialized {@link DecisionRequest} plus model.
 * Response: a {@link ProviderResult} shape, with lenient aliases accepted:
 *   choice -> {"index": n, "probabilities": [...]} or {"choice": "label"}
 *   yesno  -> {"answer": true|"yes"|1} or {"probability": 0.8}
 *   score  -> {"score": 7.5}
 *   rank   -> {"ranking": [{"index": n, "score": s}]} or {"order": [2,0,1]}
 *
 * Any self-hosted model server (Laya, von, tev1, a custom router...) that
 * speaks this minimal JSON contract becomes a Decide.js provider.
 */
export class HttpProvider implements DecisionProvider {
  readonly name: string;
  readonly model?: string;
  readonly costPerCallUsd: number;
  readonly capabilities: ProviderCapabilities;
  protected readonly url: string;
  protected readonly apiKey?: string;
  protected readonly timeoutMs: number;
  protected readonly extraHeaders: Record<string, string>;
  protected readonly extraBody: Record<string, unknown>;
  private readonly availableFn?: () => boolean;

  constructor(config: HttpProviderConfig) {
    this.name = config.name;
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = config.timeoutMs ?? 15000;
    this.extraHeaders = config.headers ?? {};
    this.extraBody = config.extraBody ?? {};
    this.costPerCallUsd = config.costPerCallUsd ?? 0;
    this.availableFn = config.available;
    this.capabilities = {
      location: config.location ?? "cloud",
      requiresApiKey: config.requiresApiKey,
      notes: config.notes,
    };
  }

  isAvailable(): boolean {
    if (this.availableFn) return this.availableFn();
    if (this.capabilities.requiresApiKey) return Boolean(this.apiKey);
    return Boolean(this.url);
  }

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<ProviderResult> {
    if (!this.isAvailable()) {
      throw new ProviderError(
        `Provider "${this.name}" is not configured (missing API key or URL)`,
        this.name,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        ...this.extraHeaders,
      };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...request, model: this.model, ...this.extraBody }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ProviderError(
          `HTTP ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`,
          this.name,
        );
      }

      const json = (await res.json()) as Record<string, unknown>;
      return normalizeResult(request, json, this.name);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new ProviderError(`Request timed out after ${this.timeoutMs}ms`, this.name, err);
      }
      throw new ProviderError((err as Error).message ?? "fetch failed", this.name, err);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Lenient response normalization shared by all HTTP-style providers. */
export function normalizeResult(
  request: DecisionRequest,
  json: Record<string, unknown>,
  providerName: string,
): ProviderResult {
  switch (request.kind) {
    case "choice": {
      if (typeof json.index === "number" && Array.isArray(json.probabilities)) {
        return {
          kind: "choice",
          index: json.index,
          probabilities: json.probabilities.map(Number),
          raw: json,
        };
      }
      if (typeof json.choice === "string") {
        const index = request.candidates.indexOf(json.choice);
        const i = index === -1 ? 0 : index;
        const probabilities = request.candidates.map((_, k) => (k === i ? 1 : 0));
        return { kind: "choice", index: i, probabilities, raw: json };
      }
      if (typeof json.index === "number") {
        const probabilities = request.candidates.map((_, k) => (k === json.index ? 1 : 0));
        return { kind: "choice", index: json.index, probabilities, raw: json };
      }
      throw new ProviderError("Response missing 'index' or 'choice'", providerName);
    }
    case "yesno": {
      if (typeof json.probability === "number") {
        return {
          kind: "yesno",
          answer: json.answer === undefined ? json.probability >= 0.5 : truthy(json.answer),
          probability: Number(json.probability),
          raw: json,
        };
      }
      if (json.answer !== undefined) {
        const answer = truthy(json.answer);
        return { kind: "yesno", answer, probability: answer ? 1 : 0, raw: json };
      }
      throw new ProviderError("Response missing 'answer' or 'probability'", providerName);
    }
    case "score": {
      if (typeof json.score !== "number") {
        throw new ProviderError("Response missing numeric 'score'", providerName);
      }
      return { kind: "score", score: json.score, raw: json };
    }
    case "rank": {
      if (Array.isArray(json.ranking)) {
        const ranking = json.ranking.map((r) => {
          const o = r as Record<string, unknown>;
          return { index: Number(o.index), score: Number(o.score ?? 0.5) };
        });
        return { kind: "rank", ranking, raw: json };
      }
      if (Array.isArray(json.order)) {
        const order = json.order as unknown[];
        const ranking = order.map((index, k) => ({
          index: Number(index),
          score: 1 - k / Math.max(order.length - 1, 1),
        }));
        return { kind: "rank", ranking, raw: json };
      }
      throw new ProviderError("Response missing 'ranking' or 'order'", providerName);
    }
  }
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v >= 0.5;
  if (typeof v === "string") return ["yes", "true", "1", "y"].includes(v.toLowerCase());
  return Boolean(v);
}

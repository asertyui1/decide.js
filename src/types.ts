/**
 * Core type definitions for the Decide.js universal decision-model SDK.
 *
 * Decision models (Jev, Laya, Kev, tev1, ...) are non-autoregressive
 * "System 1" models: instead of generating text, they return a typed decision
 * in a single round trip. This file defines the wire-level shape shared by
 * every provider.
 */

export type DecisionKind = "choice" | "yesno" | "score" | "rank";

export type ProviderLocation = "local" | "cloud";

export interface DecisionOptions {
  /** Override the client default provider for this call. */
  provider?: string;
  /** Override the fallback chain for this call. */
  fallback?: string[] | null;
  /** Bypass the cache for this call. */
  skipCache?: boolean;
  /** Free-form per-call metadata, echoed back in {@link DecisionResponse.metadata}. */
  metadata?: Record<string, unknown>;
  /** AbortSignal propagated to network-backed providers. */
  signal?: AbortSignal;
}

export interface BaseRequest {
  kind: DecisionKind;
  /** The question or instruction the decision is about. */
  question?: string;
  /** Additional context / document / payload to decide over. */
  context?: string;
  traceId?: string;
}

export interface ChoiceRequest extends BaseRequest {
  kind: "choice";
  /** Ordered, mutually exclusive candidate labels. Minimum 2 (1 is allowed for scoring-style use). */
  candidates: string[];
}

export interface YesNoRequest extends BaseRequest {
  kind: "yesno";
  /**
   * Lexicon used by the local heuristic provider.
   * - "general" (default): sentiment / status words ("broken", "passes").
   * - "safety": fail-closed guard lexicon — prompt injection, secrets,
   *   dangerous content. Technical words like "error" never count as danger.
   * Cloud providers ignore this and apply their own semantics.
   */
  mode?: "general" | "safety";
}

export interface ScoreRequest extends BaseRequest {
  kind: "score";
  /** Lower bound of the scoring scale (default 0). */
  min?: number;
  /** Upper bound of the scoring scale (default 10). */
  max?: number;
  /** What is being scored (defaults to {@link BaseRequest.question}). */
  target?: string;
}

export interface RankRequest extends BaseRequest {
  kind: "rank";
  /** Items to be ordered. */
  items: string[];
  /** Criterion used for ranking, e.g. "production urgency". */
  criterion?: string;
}

export type DecisionRequest =
  | ChoiceRequest
  | YesNoRequest
  | ScoreRequest
  | RankRequest;

/* --------------------------------- results -------------------------------- */

export interface BaseResponse {
  kind: DecisionKind;
  /** Name of the provider that produced the decision. */
  provider: string;
  /** Model identifier when the provider exposes one. */
  model?: string;
  /** Wall-clock latency measured by the client. */
  latencyMs: number;
  /** Estimated USD cost of the call (0 for local providers). */
  costUsd: number;
  /** Provider chain actually tried: [primary, ...fallbacks]. */
  attempted: string[];
  /** True when a fallback provider produced the answer. */
  degraded: boolean;
  traceId?: string;
  metadata?: Record<string, unknown>;
  /** Raw provider payload, available in debug mode. */
  raw?: unknown;
}

export interface ChoiceResponse extends BaseResponse {
  kind: "choice";
  /** Index of the winning candidate. */
  index: number;
  /** Label of the winning candidate. */
  choice: string;
  /** All candidate labels, in the order they were provided. */
  candidates: string[];
  /** Probability aligned with the candidate order; sums to ~1. */
  probabilities: number[];
  /** Probability of the winner. */
  confidence: number;
}

export interface YesNoResponse extends BaseResponse {
  kind: "yesno";
  answer: boolean;
  /** Probability that the answer is "yes", in [0, 1]. */
  probability: number;
}

export interface ScoreResponse extends BaseResponse {
  kind: "score";
  score: number;
  min: number;
  max: number;
}

export interface RankedItem {
  index: number;
  item: string;
  /** Normalized relevance score in [0, 1]. */
  score: number;
}

export interface RankResponse extends BaseResponse {
  kind: "rank";
  /** Items ordered from best to worst. */
  ranking: RankedItem[];
}

export type DecisionResponse =
  | ChoiceResponse
  | YesNoResponse
  | ScoreResponse
  | RankResponse;

/* -------------------------------- providers ------------------------------- */

/** Provider-native payload, before the client adds timing/cost/tracing. */
export type ProviderResult =
  | { kind: "choice"; index: number; probabilities: number[]; raw?: unknown }
  | { kind: "yesno"; answer: boolean; probability: number; raw?: unknown }
  | { kind: "score"; score: number; raw?: unknown }
  | {
      kind: "rank";
      ranking: Array<{ index: number; score: number }>;
      raw?: unknown;
    };

export interface ProviderCapabilities {
  location: ProviderLocation;
  /** True when credentials are required before the provider can serve calls. */
  requiresApiKey?: boolean;
  /** Human-readable notes shown by the CLI. */
  notes?: string;
}

export interface DecisionProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** Model label surfaced in responses. */
  readonly model?: string;
  /** Estimated cost per call in USD. 0 for local providers. */
  readonly costPerCallUsd?: number;
  /** Whether the provider is currently configured (key present, server up...). */
  isAvailable(): boolean | Promise<boolean>;
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<ProviderResult>;
}

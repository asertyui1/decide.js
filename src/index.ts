/**
 * Decide.js — the universal SDK for System-1 decision models.
 *
 * One typed API for Jev, Laya, Kev, tev1, self-hosted weights and local
 * heuristics. Built for AI agents that need cheap, instant, typed decisions:
 * choose / classify, yes/no, score and rank.
 *
 * @example
 * ```ts
 * import { createDecide } from "decide.js";
 *
 * const decide = createDecide();
 * const r = await decide.classify("Your account is locked, click to pay now",
 *   ["work", "billing", "spam"]);
 * // r.choice === "spam"
 * ```
 *
 * @packageDocumentation
 */

export type {
  DecisionKind,
  ProviderLocation,
  DecisionOptions,
  BaseRequest,
  ChoiceRequest,
  YesNoRequest,
  ScoreRequest,
  RankRequest,
  DecisionRequest,
  BaseResponse,
  ChoiceResponse,
  YesNoResponse,
  ScoreResponse,
  RankedItem,
  RankResponse,
  DecisionResponse,
  ProviderResult,
  ProviderCapabilities,
  DecisionProvider,
} from "./types.js";

export {
  DecideError,
  ValidationError,
  ProviderError,
  UnknownProviderError,
  AllProvidersFailedError,
  BudgetExceededError,
} from "./errors.js";

export { DecideClient } from "./client.js";
export type { DecideClientOptions, ClientStats } from "./client.js";

export { DecisionCache, Budget } from "./middleware.js";
export type { CacheOptions, BudgetOptions } from "./middleware.js";

export * as providers from "./providers/index.js";
export {
  MockProvider,
  HeuristicProvider,
  HttpProvider,
  normalizeResult,
  createJevProvider,
  createSelfHostedProvider,
  builtinProviders,
} from "./providers/index.js";
export type { HttpProviderConfig } from "./providers/http.js";
export type { JevConfig } from "./providers/jev.js";

import { DecideClient } from "./client.js";
import type { DecideClientOptions } from "./client.js";

/** Convenience factory. */
export function createDecide(options?: DecideClientOptions): DecideClient {
  return new DecideClient(options);
}

export const VERSION = "0.1.0";

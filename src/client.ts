import type {
  ChoiceRequest,
  ChoiceResponse,
  DecisionOptions,
  DecisionProvider,
  DecisionRequest,
  DecisionResponse,
  RankRequest,
  RankResponse,
  RankedItem,
  ScoreRequest,
  YesNoRequest,
} from "./types.js";
import {
  AllProvidersFailedError,
  UnknownProviderError,
  ValidationError,
} from "./errors.js";
import { Budget, type BudgetOptions, DecisionCache, type CacheOptions } from "./middleware.js";
import { builtinProviders } from "./providers/index.js";

export interface DecideClientOptions {
  providers?: DecisionProvider[];
  /** Provider used when a call doesn't name one. Default: "heuristic". */
  defaultProvider?: string;
  /** Fallback chain tried in order after the primary fails / is unavailable. */
  fallback?: string[];
  cache?: CacheOptions | false;
  budget?: BudgetOptions;
  /** Include raw provider payloads in responses. */
  debug?: boolean;
}

export interface ClientStats {
  calls: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  spentUsd: number;
  byProvider: Record<string, number>;
}

export class DecideClient {
  private readonly providers = new Map<string, DecisionProvider>();
  private readonly defaultProvider: string;
  private readonly fallback: string[];
  private readonly cache: DecisionCache;
  private readonly budget: Budget;
  private readonly debug: boolean;
  private errors = 0;
  private readonly byProvider: Record<string, number> = {};

  constructor(options: DecideClientOptions = {}) {
    for (const p of options.providers ?? builtinProviders()) this.register(p);
    this.defaultProvider = options.defaultProvider ?? "heuristic";
    this.fallback = options.fallback ?? ["heuristic", "mock"];
    this.cache = options.cache === false ? new DecisionCache() : new DecisionCache(options.cache);
    this.budget = new Budget(options.budget);
    this.debug = options.debug ?? false;

    if (!this.providers.has(this.defaultProvider)) {
      throw new UnknownProviderError(this.defaultProvider);
    }
  }

  register(provider: DecisionProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  listProviders(): Array<{
    name: string;
    location: string;
    available: boolean;
    model?: string;
    notes?: string;
  }> {
    return [...this.providers.values()].map((p) => ({
      name: p.name,
      location: p.capabilities.location,
      available: safeAvailable(p),
      model: p.model,
      notes: p.capabilities.notes,
    }));
  }

  /* ------------------------------- public API ------------------------------ */

  /** Core entry point: execute any validated decision request. */
  async call(
    request: DecisionRequest,
    options: DecisionOptions = {},
  ): Promise<DecisionResponse> {
    validate(request);

    const primary = options.provider ?? this.defaultProvider;
    if (!this.providers.has(primary)) throw new UnknownProviderError(primary);

    const chain = unique([
      primary,
      ...(options.fallback === null ? [] : (options.fallback ?? this.fallback)),
    ]).filter((name) => {
      const p = this.providers.get(name);
      if (!p) return false;
      return true;
    });

    const skipped: string[] = [];
    const failures: Array<{ provider: string; error: unknown }> = [];
    const attempted: string[] = [];

    for (const name of chain) {
      const provider = this.providers.get(name)!;
      const available = await Promise.resolve(provider.isAvailable()).catch(() => false);
      if (!available) {
        skipped.push(name);
        continue;
      }

      // Cache lookup (per provider).
      const cacheKey = DecisionCache.key(name, request);
      if (this.cache.enabled && !options.skipCache) {
        const hit = this.cache.get(cacheKey) as DecisionResponse | undefined;
        if (hit) {
          this.byProvider[name] = (this.byProvider[name] ?? 0) + 1;
          return withMeta(hit, { cacheHit: true, skipped });
        }
      }

      this.budget.guard();
      attempted.push(name);
      const started = performance.now();
      try {
        const result = await provider.decide(request, options.signal);
        const latencyMs = Math.round((performance.now() - started) * 1000) / 1000;
        const costUsd = provider.costPerCallUsd ?? 0;
        this.budget.record(costUsd);
        this.byProvider[name] = (this.byProvider[name] ?? 0) + 1;

        const response = assemble(
          request,
          result,
          name,
          provider.model,
          latencyMs,
          costUsd,
          attempted,
          name !== primary,
          this.debug,
          options.metadata,
          request.traceId,
          skipped,
        );
        if (this.cache.enabled && !options.skipCache) this.cache.set(cacheKey, response);
        return response;
      } catch (error) {
        failures.push({ provider: name, error });
        this.errors++;
      }
    }

    throw new AllProvidersFailedError(
      attempted.length ? attempted : chain,
      failures.length
        ? failures
        : [
            {
              provider: chain.join("/"),
              error: new Error("no configured provider is available (missing API key?)"),
            },
          ],
    );
  }

  /** Pick one candidate. Classification is `choose` over labels. */
  choose(
    question: string,
    candidates: string[],
    options: { context?: string } & DecisionOptions = {},
  ): Promise<ChoiceResponse> {
    const req: ChoiceRequest = {
      kind: "choice",
      question,
      candidates,
      context: options.context,
    };
    return this.call(req, options) as Promise<ChoiceResponse>;
  }

  /** Classify text into one of the given labels. */
  classify(
    text: string,
    labels: string[],
    options: { question?: string } & DecisionOptions = {},
  ): Promise<ChoiceResponse> {
    const req: ChoiceRequest = {
      kind: "choice",
      question: options.question ?? "Classify the following text.",
      context: text,
      candidates: labels,
    };
    return this.call(req, options) as Promise<ChoiceResponse>;
  }

  yesno(
    question: string,
    options: { context?: string; mode?: "general" | "safety" } & DecisionOptions = {},
  ): Promise<DecisionResponse> {
    const req: YesNoRequest = {
      kind: "yesno",
      question,
      context: options.context,
      mode: options.mode,
    };
    return this.call(req, options);
  }

  score(
    question: string,
    options: { min?: number; max?: number; target?: string; context?: string } & DecisionOptions = {},
  ): Promise<DecisionResponse> {
    const req: ScoreRequest = {
      kind: "score",
      question,
      context: options.context,
      min: options.min,
      max: options.max,
      target: options.target,
    };
    return this.call(req, options);
  }

  rank(
    items: string[],
    options: { criterion?: string; question?: string; context?: string } & DecisionOptions = {},
  ): Promise<RankResponse> {
    const req: RankRequest = {
      kind: "rank",
      items,
      criterion: options.criterion,
      question: options.question,
      context: options.context,
    };
    return this.call(req, options) as Promise<RankResponse>;
  }

  stats(): ClientStats {
    return {
      calls: this.budget.calls,
      errors: this.errors,
      cacheHits: this.cache.hits,
      cacheMisses: this.cache.misses,
      spentUsd: Math.round(this.budget.spentUsd * 1e9) / 1e9,
      byProvider: { ...this.byProvider },
    };
  }
}

/* --------------------------------- helpers -------------------------------- */

function validate(request: DecisionRequest): void {
  switch (request.kind) {
    case "choice":
      if (!Array.isArray(request.candidates) || request.candidates.length === 0) {
        throw new ValidationError("choice requires a non-empty `candidates` array");
      }
      if (request.candidates.some((c) => typeof c !== "string" || c.trim() === "")) {
        throw new ValidationError("every candidate must be a non-empty string");
      }
      if (new Set(request.candidates).size !== request.candidates.length) {
        throw new ValidationError("candidates must be unique");
      }
      break;
    case "rank":
      if (!Array.isArray(request.items) || request.items.length === 0) {
        throw new ValidationError("rank requires a non-empty `items` array");
      }
      break;
    case "score": {
      const min = request.min ?? 0;
      const max = request.max ?? 10;
      if (max <= min) throw new ValidationError("score requires max > min");
      break;
    }
    case "yesno":
      break;
  }
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function safeAvailable(p: DecisionProvider): boolean {
  try {
    const v = p.isAvailable();
    return Boolean(typeof v === "boolean" ? v : false);
  } catch {
    return false;
  }
}

function withMeta(response: DecisionResponse, extra: Record<string, unknown>): DecisionResponse {
  return {
    ...response,
    metadata: { ...(response.metadata ?? {}), ...extra },
  };
}

function assemble(
  request: DecisionRequest,
  result: Awaited<ReturnType<DecisionProvider["decide"]>>,
  provider: string,
  model: string | undefined,
  latencyMs: number,
  costUsd: number,
  attempted: string[],
  degraded: boolean,
  debug: boolean,
  metadata: Record<string, unknown> | undefined,
  traceId: string | undefined,
  skipped: string[],
): DecisionResponse {
  const base = {
    provider,
    model,
    latencyMs,
    costUsd,
    attempted,
    degraded,
    traceId,
    metadata: { skipped: skipped.length ? skipped : undefined, ...metadata },
    raw: debug ? result.raw : undefined,
  };

  switch (result.kind) {
    case "choice": {
      const r = request as ChoiceRequest;
      const choice = r.candidates[result.index] ?? r.candidates[0]!;
      const probabilities = result.probabilities.map((p) => round6(p));
      return {
        ...base,
        kind: "choice",
        index: result.index,
        choice,
        candidates: r.candidates,
        probabilities,
        confidence: round6(probabilities[result.index] ?? 0),
      };
    }
    case "yesno":
      return {
        ...base,
        kind: "yesno",
        answer: result.answer,
        probability: round6(result.probability),
      };
    case "score": {
      const r = request as ScoreRequest;
      return {
        ...base,
        kind: "score",
        score: round6(result.score),
        min: r.min ?? 0,
        max: r.max ?? 10,
      };
    }
    case "rank": {
      const r = request as RankRequest;
      const ranking: RankedItem[] = result.ranking.map((x) => ({
        index: x.index,
        item: r.items[x.index] ?? `#${x.index}`,
        score: round6(x.score),
      }));
      const resp: RankResponse = { ...base, kind: "rank", ranking };
      return resp;
    }
  }
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

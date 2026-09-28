import { fnv1a } from "./hash.js";
import type { DecisionRequest } from "./types.js";
import { BudgetExceededError } from "./errors.js";

/* --------------------------------- cache ---------------------------------- */

export interface CacheOptions {
  /** Entries older than ttlMs are evicted lazily. 0 disables caching. */
  ttlMs?: number;
  /** Maximum number of entries. */
  max?: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Tiny in-memory TTL cache. One process per client; swap for Redis later. */
export class DecisionCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly max: number;
  hits = 0;
  misses = 0;

  constructor(opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 0;
    this.max = opts.max ?? 10_000;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  static key(provider: string, request: DecisionRequest): string {
    return provider + ":" + fnv1a(JSON.stringify(request)).toString(36);
  }

  get(key: string): unknown | undefined {
    if (!this.enabled) return undefined;
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    // Refresh insertion order for LRU-ish eviction.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown): void {
    if (!this.enabled) return;
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/* --------------------------------- budget --------------------------------- */

export interface BudgetOptions {
  /** Maximum number of provider calls (cache hits don't count). */
  maxCalls?: number;
  /** Maximum cumulative estimated USD cost. */
  maxCostUsd?: number;
}

export class Budget {
  calls = 0;
  spentUsd = 0;
  private readonly maxCalls?: number;
  private readonly maxCostUsd?: number;

  constructor(opts: BudgetOptions = {}) {
    this.maxCalls = opts.maxCalls;
    this.maxCostUsd = opts.maxCostUsd;
  }

  /** Throws before a call that would exceed the call budget. */
  guard(): void {
    if (this.maxCalls !== undefined && this.calls >= this.maxCalls) {
      throw new BudgetExceededError(
        `Call budget exceeded: ${this.calls}/${this.maxCalls}`,
        this.calls,
        this.maxCalls,
      );
    }
  }

  record(costUsd: number): void {
    this.calls++;
    this.spentUsd += costUsd;
    if (this.maxCostUsd !== undefined && this.spentUsd > this.maxCostUsd) {
      throw new BudgetExceededError(
        `Cost budget exceeded: $${this.spentUsd.toFixed(6)} > $${this.maxCostUsd}`,
        this.spentUsd,
        this.maxCostUsd,
      );
    }
  }
}

import { describe, expect, it } from "vitest";
import { DecideClient } from "../src/client.js";
import { ValidationError, BudgetExceededError, UnknownProviderError, AllProvidersFailedError } from "../src/errors.js";
import { MockProvider } from "../src/providers/mock.js";
import type { DecisionProvider, ProviderResult, DecisionRequest } from "../src/types.js";

class CountingProvider implements DecisionProvider {
  readonly name = "counter";
  readonly capabilities = { location: "local" as const };
  readonly costPerCallUsd = 0;
  calls = 0;
  private readonly inner = new MockProvider();
  isAvailable(): boolean {
    return true;
  }
  async decide(request: DecisionRequest): Promise<ProviderResult> {
    this.calls++;
    return this.inner.decide(request);
  }
}

class FailProvider implements DecisionProvider {
  readonly name = "failer";
  readonly capabilities = { location: "local" as const };
  isAvailable(): boolean {
    return true;
  }
  async decide(): Promise<ProviderResult> {
    throw new Error("boom");
  }
}

describe("DecideClient validation", () => {
  const client = new DecideClient();

  it("rejects empty candidates and duplicate labels", async () => {
    await expect(client.choose("q", [])).rejects.toBeInstanceOf(ValidationError);
    await expect(client.choose("q", ["a", "a"])).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects rank without items and inverted score scale", async () => {
    await expect(client.rank([])).rejects.toBeInstanceOf(ValidationError);
    await expect(client.score("q", { min: 10, max: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects unknown providers", async () => {
    await expect(client.choose("q", ["a", "b"], { provider: "nope" })).rejects.toBeInstanceOf(
      UnknownProviderError,
    );
  });
});

describe("DecideClient fallback chain", () => {
  it("degrades to the next provider and marks the response", async () => {
    const client = new DecideClient({
      providers: [new FailProvider(), new MockProvider()],
      defaultProvider: "failer",
      fallback: ["mock"],
    });
    const r = await client.classify("hello world", ["a", "b"]);
    expect(r.provider).toBe("mock");
    expect(r.degraded).toBe(true);
    expect(r.attempted).toEqual(["failer", "mock"]);
  });

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const client = new DecideClient({
      providers: [new FailProvider()],
      defaultProvider: "failer",
      fallback: [],
    });
    await expect(client.choose("q", ["a", "b"])).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("skips providers that are not available", async () => {
    class OfflineCloud implements DecisionProvider {
      readonly name = "cloud-x";
      readonly capabilities = { location: "cloud" as const, requiresApiKey: true };
      isAvailable(): boolean {
        return false;
      }
      async decide(): Promise<ProviderResult> {
        throw new Error("should not be called");
      }
    }
    const client = new DecideClient({
      providers: [new OfflineCloud(), new MockProvider()],
      defaultProvider: "cloud-x",
      fallback: ["mock"],
    });
    const r = await client.choose("q", ["a", "b"]);
    expect(r.provider).toBe("mock");
  });
});

describe("DecideClient cache", () => {
  it("serves identical calls from cache and reports hits", async () => {
    const counter = new CountingProvider();
    const client = new DecideClient({
      providers: [counter],
      defaultProvider: "counter",
      fallback: [],
      cache: { ttlMs: 60_000 },
    });
    await client.choose("same question", ["a", "b"]);
    await client.choose("same question", ["a", "b"]);
    expect(counter.calls).toBe(1);
    expect(client.stats().cacheHits).toBe(1);
  });

  it("skipCache forces a new call", async () => {
    const counter = new CountingProvider();
    const client = new DecideClient({
      providers: [counter],
      defaultProvider: "counter",
      fallback: [],
      cache: { ttlMs: 60_000 },
    });
    await client.choose("q", ["a", "b"]);
    await client.choose("q", ["a", "b"], { skipCache: true });
    expect(counter.calls).toBe(2);
  });
});

describe("DecideClient budget", () => {
  it("stops after maxCalls", async () => {
    const counter = new CountingProvider();
    const client = new DecideClient({
      providers: [counter],
      defaultProvider: "counter",
      fallback: [],
      cache: false,
      budget: { maxCalls: 2 },
    });
    await client.choose("q1", ["a", "b"]);
    await client.choose("q2", ["a", "b"]);
    await expect(client.choose("q3", ["a", "b"])).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

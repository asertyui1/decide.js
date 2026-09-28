import type { DecisionProvider, DecisionRequest, ProviderResult } from "../types.js";
import { seededRandom } from "../hash.js";
import { softmax } from "../text.js";

/**
 * Deterministic offline provider.
 *
 * The same request always yields the same decision (seeded by its content),
 * which makes it perfect for tests, CI, reproducible demos and as the final
 * fallback of the chain. It makes no network calls and needs no API key.
 */
export class MockProvider implements DecisionProvider {
  readonly name = "mock";
  readonly capabilities = {
    location: "local" as const,
    notes: "Deterministic seeded decisions. Offline. Great for tests & CI.",
  };
  readonly costPerCallUsd = 0;

  isAvailable(): boolean {
    return true;
  }

  async decide(request: DecisionRequest): Promise<ProviderResult> {
    const seed = JSON.stringify(request);

    switch (request.kind) {
      case "choice": {
        const rand = seededRandom(seed);
        const logits = request.candidates.map((c) => {
          // Mix per-candidate entropy in.
          const r = seededRandom(seed + "::" + c)();
          return rand() * 0.5 + r * 1.5;
        });
        const probabilities = softmax(logits, 0.8);
        const index = argmax(probabilities);
        return { kind: "choice", index, probabilities };
      }
      case "yesno": {
        const p = 0.15 + seededRandom(seed)() * 0.7;
        return { kind: "yesno", answer: p >= 0.5, probability: round(p) };
      }
      case "score": {
        const min = request.min ?? 0;
        const max = request.max ?? 10;
        const p = seededRandom(seed)();
        return { kind: "score", score: round(min + p * (max - min)) };
      }
      case "rank": {
        const scores = request.items.map((item) => seededRandom(seed + "::" + item)());
        const order = [...scores.keys()].sort((a, b) => scores[b]! - scores[a]!);
        return {
          kind: "rank",
          ranking: order.map((index) => ({ index, score: round(scores[index]!) })),
        };
      }
    }
  }
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i]! > xs[best]!) best = i;
  }
  return best;
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

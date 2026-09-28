import type { DecisionProvider } from "../types.js";
import { MockProvider } from "./mock.js";
import { HeuristicProvider } from "./heuristic.js";
import { HttpProvider, type HttpProviderConfig } from "./http.js";
import { createJevProvider, createSelfHostedProvider, type JevConfig } from "./jev.js";

export { MockProvider } from "./mock.js";
export { HeuristicProvider } from "./heuristic.js";
export { HttpProvider, normalizeResult, type HttpProviderConfig } from "./http.js";
export {
  createJevProvider,
  createSelfHostedProvider,
  type JevConfig,
} from "./jev.js";

/**
 * The built-in provider set. Cloud providers that lack credentials are
 * registered anyway (so `decide providers` can show setup instructions) but
 * skipped automatically at call time.
 */
export function builtinProviders(): DecisionProvider[] {
  return [
    new HeuristicProvider(),
    new MockProvider(),
    createJevProvider(),
    createSelfHostedProvider(),
  ];
}

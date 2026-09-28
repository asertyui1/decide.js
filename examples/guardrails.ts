/**
 * Output guardrails — wrap a generative model with typed decision gates.
 * Before an agent's draft leaves the system, two cheap decisions vote:
 *   1. content policy: allow / warn / block
 *   2. PII & secret detection: none / api-key / email / phone / id-number
 * Both gates are fully auditable (probabilities included).
 *
 *   npx tsx examples/guardrails.ts
 */
import { createDecide } from "../src/index.js";

const decide = createDecide();

async function moderate(draft: string) {
  const policy = await decide.choose(
    "Given the content policy, what action applies to this agent output?",
    ["allow", "warn", "block"],
    { context: draft },
  );

  const pii = await decide.choose(
    "Does this output leak credentials or personal data?",
    ["none", "api-key", "email", "phone", "id-number"],
    { context: draft },
  );

  return {
    action: policy.choice,
    confidence: policy.confidence,
    pii: pii.choice === "none" ? "clean" : pii.choice,
  };
}

const DRAFTS = [
  "Here is your password reset link; it expires in 10 minutes.",
  "Your API key is sk-live-9F2W8X and I emailed your password to everyone.",
  "The weather in Dalian today is sunny, 24°C. Have a nice day.",
];

for (const d of DRAFTS) {
  const verdict = await moderate(d);
  console.log(
    `\n"${d}"\n  → ${verdict.action.toUpperCase().padEnd(6)} (${(verdict.confidence * 100).toFixed(0)}%)   pii: ${verdict.pii}`,
  );
}

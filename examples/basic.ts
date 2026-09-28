/**
 * Basic end-to-end tour of the SDK. Runs fully offline.
 *   npx tsx examples/basic.ts
 */
import { createDecide } from "../src/index.js";

const decide = createDecide();

// 1. Pick one candidate from a set (typed probabilities over the labels).
const pick = await decide.choose(
  "Which is the most urgent production incident to handle right now?",
  ["refactor utils", "fix P0 login outage", "update logo"],
);
console.log("choose →", pick.choice, `(${(pick.confidence * 100).toFixed(0)}%)`);

// 2. Classify free text into labels.
const label = await decide.classify(
  "Your account has been locked. Click this link and pay immediately within 24h.",
  ["work", "billing", "spam", "personal"],
);
console.log("classify →", label.choice, label.probabilities);

// 3. Yes / no gate.
const safe = await decide.yesno("Is this PR safe to deploy?", {
  context: "All tests pass, deploy is working and approved.",
});
console.log("yesno →", safe.answer, `p=${safe.probability}`);

// 4. Scored judgment on any scale.
const score = await decide.score("How polished is this release?", {
  context: "excellent, perfect, great, everything works",
  min: 0,
  max: 100,
});
console.log("score →", score.score, "/", score.max);

// 5. Rank a list by a criterion.
const ranked = await decide.rank(
  ["Update logo", "Login outage P0 blocker", "Refactor utils", "Security patch: token leakage"],
  { criterion: "production urgency" },
);
console.log("rank →", ranked.ranking.map((r) => r.item).join(" > "));

console.log("\nstats →", decide.stats());

/**
 * Batch email triage — the canonical cheap-decision workload.
 * Every message gets one decision call instead of a generated-text LLM call:
 * sub-millisecond locally, fractions of a cent against cloud decision models.
 *
 *   npx tsx examples/email-triage.ts
 */
import { createDecide } from "../src/index.js";

const LABELS = ["work", "billing", "spam", "personal"];

const EMAILS = [
  {
    from: "no-reply@bank-notice.co",
    subject: "Account locked — verify within 24h",
    body: "Dear customer, click this link and pay immediately to avoid permanent suspension.",
  },
  {
    from: "billing@acme.dev",
    subject: "Invoice #2026-0918 for your subscription renewal",
    body: "Please find attached your invoice. Payment due in 15 days. Receipt on request.",
  },
  {
    from: "eng@acme.dev",
    subject: "Deploy standup moved to 10:00",
    body: "Sprint review after the meeting, please update Jira before standup.",
  },
  {
    from: "mom@family.example",
    subject: "Birthday dinner this weekend?",
    body: "Thinking of you — can you send the vacation photos? Love, mom.",
  },
];

const decide = createDecide();

for (const mail of EMAILS) {
  const verdict = await decide.classify(`${mail.subject}\n${mail.body}`, LABELS);
  const pct = (verdict.confidence * 100).toFixed(0).padStart(3);
  console.log(`${verdict.choice.padEnd(8)} ${pct}%  ${mail.subject}`);
}

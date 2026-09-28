import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cli = path.join(root, "src", "cli", "index.ts");

function run(args: string[], input?: string) {
  return execFileSync(process.execPath, ["--import", "tsx", cli, ...args], {
    cwd: root,
    input,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

describe("decide CLI", () => {
  it("classifies piped email as spam with --json", () => {
    const out = run(
      ["classify", "-", "--labels", "work,billing,spam,personal", "--json", "--no-color"],
      "Your account has been locked. Click this link and pay immediately within 24h.",
    );
    const parsed = JSON.parse(out);
    expect(parsed.kind).toBe("choice");
    expect(parsed.choice).toBe("spam");
    expect(parsed.candidates).toEqual(["work", "billing", "spam", "personal"]);
    expect(parsed.provider).toBe("heuristic");
  });

  it("renders human-readable probability bars by default", () => {
    const out = run([
      "choose",
      "Which task first?",
      "--candidates",
      "fix bug,write docs",
      "--no-color",
    ]);
    expect(out).toContain("fix bug");
    expect(out).toMatch(/\d+\.\d%/);
  });

  it("answers yes/no from context", () => {
    const out = run([
      "yesno",
      "Is it broken?",
      "--context",
      "everything fails, the service crashes with an error",
      "--json",
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.answer).toBe(false);
  });

  it("ranks comma-separated items", () => {
    const out = run([
      "rank",
      "P0 login outage,rebrand footer,refactor helpers",
      "--criterion",
      "urgency",
      "--json",
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.ranking).toHaveLength(3);
    expect(parsed.ranking[0].item).toContain("P0");
  });

  it("lists providers with availability", () => {
    const out = run(["providers", "--no-color"]);
    expect(out).toContain("heuristic");
    expect(out).toContain("jev");
    expect(out).toMatch(/ready|not configured/);
  });

  it("runs the benchmark", () => {
    const out = run(["bench", "--runs", "2", "--no-color"]);
    expect(out).toContain("benchmark");
    expect(out).toContain("heuristic");
  }, 30000);

  it("exits non-zero on validation errors", () => {
    expect(() => run(["choose", "q"])).toThrow();
  });

  it("prints version", () => {
    expect(run(["--version"]).trim()).toMatch(/^decide \d+\.\d+\.\d+$/);
  });
});

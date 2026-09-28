#!/usr/bin/env node
import { DecideClient } from "../client.js";
import type {
  ChoiceResponse,
  DecisionOptions,
  DecisionResponse,
  RankResponse,
} from "../types.js";
import { builtinProviders } from "../providers/index.js";
import { DecideError } from "../errors.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

const ALIASES: Record<string, string> = {
  tag: "classify",
  pick: "choose",
  decide: "yesno",
};

const HELP = `decide — universal CLI for System-1 decision models (Jev, Laya, local heuristics)

USAGE
  decide <command> [input] [flags]

COMMANDS
  classify <text|->   Classify text into one of the labels (reads stdin with -)
  choose   <question> Pick one of --candidates
  yesno    <question> Answer yes or no
  score    <question> Score on a scale (--min, --max)
  rank     <items|->  Rank items (comma-separated, or one per stdin line)
  providers           List configured providers and their status
  bench               Latency / availability comparison across providers
  help, --help        Show this help
  --version           Show version

FLAGS
  -p, --provider <n>     Provider to use (default: heuristic)
      --fallback <chain> Comma-separated fallback chain; "" disables fallback
  -q, --question <s>     Question text
  -c, --context <s>      Context text
      --labels <a,b>     Labels for classify
      --candidates <a,b> Candidates for choose
      --criterion <s>    Ranking criterion
      --min <n>          Score scale minimum (default 0)
      --max <n>          Score scale maximum (default 10)
      --runs <n>         bench iterations (default 20)
      --json             Machine-readable JSON output
      --no-color         Disable colors

EXAMPLES
  echo "Account locked, click here to pay immediately" \\
    | decide classify - --labels "work,billing,spam"
  decide choose "When should we ship?" --candidates "today,tomorrow,next week"
  decide yesno "Does this diff contain a database migration?" --context "$(git diff)"
  decide rank "Fix login bug,Rebrand logo,Refactor tests" --criterion "prod urgency"
`;

async function main(argv: string[], stdin: string): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write("decide 0.1.0\n");
    return 0;
  }

  const args = parseArgs(argv);
  const command = ALIASES[args.command] ?? args.command;
  const json = args.flags.get("json") === true;
  if (args.flags.get("noColor") === true || process.env.NO_COLOR) useColor(false);

  const client = new DecideClient({ providers: builtinProviders() });

  try {
    let out: DecisionResponse | null = null;
    let exitCode = 0;
    switch (command) {
      case "classify":
        out = await classify(client, args, stdin);
        break;
      case "choose":
        out = await choose(client, args);
        break;
      case "yesno":
        out = await yesno(client, args, stdin);
        break;
      case "score":
        out = await score(client, args, stdin);
        break;
      case "rank":
        out = await rank(client, args, stdin);
        break;
      case "providers":
        exitCode = await listProviders(client, json);
        break;
      case "bench":
        exitCode = await bench(client, args);
        break;
      default:
        process.stderr.write(red(`Unknown command: ${command}\n\n`) + HELP);
        return 1;
    }
    if (out) {
      process.stdout.write(json ? JSON.stringify(out, null, 2) + "\n" : render(out));
    }
    return exitCode;
  } catch (err) {
    if (err instanceof DecideError) {
      process.stderr.write(red(`error: ${err.message}\n`));
      return 1;
    }
    throw err;
  }
}

/* ------------------------------- commands --------------------------------- */

function callOptions(args: ParsedArgs): DecisionOptions {
  const provider = str(args, "provider", "p");
  const rawFallback = args.flags.get("fallback");
  return {
    provider: provider ?? undefined,
    fallback:
      rawFallback === ""
        ? null
        : typeof rawFallback === "string"
          ? rawFallback.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
  };
}

async function classify(client: DecideClient, args: ParsedArgs, stdin: string) {
  const labels = list(args, "labels");
  if (labels.length === 0) throw new DecideError("classify requires --labels");
  const first = args.positionals[0];
  const text = [
    str(args, "context", "c"),
    first && first !== "-" ? first : "",
    first === "-" ? stdin : "",
    first === undefined ? stdin : "",
  ].filter(Boolean).join("\n").trim();
  if (!text) throw new DecideError("no input text (pass an argument or pipe stdin with -)");
  return client.classify(text, labels, {
    question: str(args, "question", "q"),
    ...callOptions(args),
  });
}

async function choose(client: DecideClient, args: ParsedArgs) {
  const candidates = list(args, "candidates");
  if (candidates.length === 0) throw new DecideError("choose requires --candidates");
  const question = args.positionals[0] || str(args, "question", "q");
  if (!question) throw new DecideError("choose requires a question");
  return client.choose(question, candidates, {
    context: str(args, "context", "c"),
    ...callOptions(args),
  });
}

async function yesno(client: DecideClient, args: ParsedArgs, stdin: string) {
  const question = args.positionals[0] || str(args, "question", "q");
  if (!question) throw new DecideError("yesno requires a question");
  return client.yesno(question, {
    context: str(args, "context", "c") || stdin || undefined,
    ...callOptions(args),
  });
}

async function score(client: DecideClient, args: ParsedArgs, stdin: string) {
  const question = args.positionals[0] || str(args, "question", "q");
  if (!question) throw new DecideError("score requires a question");
  return client.score(question, {
    context: str(args, "context", "c") || stdin || undefined,
    min: num(args, "min"),
    max: num(args, "max"),
    ...callOptions(args),
  });
}

async function rank(client: DecideClient, args: ParsedArgs, stdin: string) {
  const first = args.positionals[0];
  let items: string[];
  if (first === "-" || first === undefined) items = stdin.split(/\r?\n/);
  else items = first.split(",");
  items = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (items.length === 0) throw new DecideError("rank requires items (comma-separated or stdin lines)");
  return client.rank(items, {
    criterion: str(args, "criterion"),
    question: str(args, "question", "q"),
    context: str(args, "context", "c"),
    ...callOptions(args),
  });
}

async function listProviders(client: DecideClient, json: boolean): Promise<number> {
  const list = client.listProviders();
  if (json) {
    process.stdout.write(JSON.stringify(list, null, 2) + "\n");
    return 0;
  }
  for (const p of list) {
    const dot = p.available ? green("●") : yellow("○");
    const loc = p.location === "local" ? cyan("local") : magenta("cloud");
    process.stdout.write(
      `${dot} ${bold(p.name.padEnd(12))} ${loc.padEnd(6)} ${p.model ? dim(p.model.padEnd(10)) : "".padEnd(10)} ${p.available ? green("ready") : dim("not configured")}\n`,
    );
    if (p.notes) process.stdout.write(`   ${dim(p.notes)}\n`);
  }
  return 0;
}

/* --------------------------------- bench ---------------------------------- */

const SCENARIOS = [
  {
    name: "email: spam triage",
    run: (c: DecideClient, p: string) =>
      c.classify(
        "Dear customer, your account has been locked. Click this link and pay immediately within 24h to avoid suspension.",
        ["work", "billing", "spam", "personal"],
        { provider: p, fallback: null },
      ),
    label: (r: DecisionResponse) => (r.kind === "choice" ? r.choice : ""),
  },
  {
    name: "pr gate: safe to deploy?",
    run: (c: DecideClient, p: string) =>
      c.yesno("Is this PR safe to deploy?", {
        context:
          "CI: tests fail on Node 20, the service crashes on startup, error logs on every request, health check is broken.",
        provider: p,
        fallback: null,
      }),
    label: (r: DecisionResponse) => (r.kind === "yesno" ? (r.answer ? "yes" : "no") : "?"),
  },
  {
    name: "rank backlog by urgency",
    run: (c: DecideClient, p: string) =>
      c.rank(
        [
          "Login fails for 30% of iOS users (P0 blocker)",
          "Update logo on settings page",
          "Refactor internal utils module",
          "Security patch: token leakage in logs",
        ],
        { criterion: "production urgency", provider: p, fallback: null },
      ),
    label: (r: DecisionResponse) =>
      r.kind === "rank" ? r.ranking[0]!.item.slice(0, 40) : "?",
  },
] as const;

async function bench(client: DecideClient, args: ParsedArgs): Promise<number> {
  const runs = Number(args.flags.get("runs") ?? 20);
  const available = client.listProviders().filter((p) => p.available);
  if (available.length === 0) throw new DecideError("no available providers");

  process.stdout.write(
    bold("\nDecide.js cross-provider benchmark\n") +
      dim(`  ${runs} runs × ${available.length} providers × ${SCENARIOS.length} scenarios\n\n`),
  );

  for (const scenario of SCENARIOS) {
    process.stdout.write(bold(`▸ ${scenario.name}\n`));
    for (const p of available) {
      const samples: number[] = [];
      let decision = "";
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const r = await scenario.run(client, p.name);
        samples.push(performance.now() - t0);
        if (i === 0) decision = scenario.label(r);
      }
      samples.sort((a, b) => a - b);
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const p50 = samples[Math.floor(samples.length / 2)]!;
      process.stdout.write(
        `  ${p.name.padEnd(12)} mean ${cyan(mean.toFixed(3).padStart(9))}ms   p50 ${p50.toFixed(3).padStart(9)}ms   → ${green(decision)}\n`,
      );
    }
    process.stdout.write("\n");
  }
  process.stdout.write(dim("Cloud/self-hosted providers appear after JEV_API_KEY / DECIDE_SELFHOST_URL are set.\n"));
  return 0;
}

/* -------------------------------- rendering ------------------------------- */

function render(r: DecisionResponse): string {
  const meta =
    `  ${dim("provider=" + r.provider)}` +
    (r.degraded ? " " + yellow("degraded") : "") +
    ` ${dim(r.latencyMs.toFixed(2) + "ms")} ${dim("$" + r.costUsd.toFixed(6))}\n`;

  if (r.kind === "choice") {
    const c = r as ChoiceResponse;
    const lines = c.candidates.map((label, i) => {
      const winner = i === c.index;
      return `${winner ? green("▸") : " "} ${bold(label).padEnd(20)} ${bar(c.probabilities[i] ?? 0)} ${((c.probabilities[i] ?? 0) * 100).toFixed(1).padStart(5)}%`;
    });
    return bold("\n" + c.choice + "\n") + lines.join("\n") + "\n" + meta;
  }
  if (r.kind === "yesno") {
    return (
      bold(`\n${r.answer ? green("YES") : red("NO")}  `) +
      bar(r.probability) +
      ` ${(r.probability * 100).toFixed(1)}% yes\n` +
      meta
    );
  }
  if (r.kind === "score") {
    const t = (r.score - r.min) / (r.max - r.min);
    return (
      bold(`\n${r.score} `) + dim(`(${r.min}–${r.max})\n  `) + bar(t) + "\n" + meta
    );
  }
  const rr = r as RankResponse;
  const lines = rr.ranking.map(
    (x, i) =>
      `  ${bold(String(i + 1).padStart(2))}. ${x.item.slice(0, 50).padEnd(51)} ${bar(x.score)} ${(x.score * 100).toFixed(0)}%`,
  );
  return bold("\nRanking\n") + lines.join("\n") + "\n" + meta;
}

function bar(ratio: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width);
  return cyan("█".repeat(filled)) + dim("░".repeat(width - filled));
}

/* -------------------------------- arg utils ------------------------------- */

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | boolean>();
  let command = "";
  const shorthand: Record<string, string> = { p: "provider", q: "question", c: "context" };
  const boolFlags = new Set(["json", "noColor"]);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      const rawKey = eq === -1 ? body : body.slice(0, eq);
      const key = rawKey.replace(/-([a-z])/g, (_, m: string) => m.toUpperCase());
      const inline = eq === -1 ? undefined : body.slice(eq + 1);
      const next = inline ?? argv[i + 1];
      if (boolFlags.has(key) || next === undefined || next.startsWith("-")) {
        flags.set(key, inline ?? true);
      } else {
        flags.set(key, next);
        if (inline === undefined) i++;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const key = shorthand[token.slice(1)] ?? token.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else if (!command) {
      command = token;
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, flags };
}

function str(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = args.flags.get(k);
    if (typeof v === "string") return v;
  }
  return undefined;
}

function num(args: ParsedArgs, key: string): number | undefined {
  const v = args.flags.get(key);
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function list(args: ParsedArgs, key: string): string[] {
  const v = args.flags.get(key);
  return typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/* ---------------------------------- color --------------------------------- */

let colorEnabled = process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
function useColor(v: boolean): void {
  colorEnabled = v;
}
function wrap(open: number, s: string, close = 39): string {
  return colorEnabled ? `\x1b[${open}m${s}\x1b[${close}m` : s;
}
const bold = (s: string) => wrap(1, s, 22);
const dim = (s: string) => wrap(2, s, 22);
const red = (s: string) => wrap(31, s);
const green = (s: string) => wrap(32, s);
const yellow = (s: string) => wrap(33, s);
const cyan = (s: string) => wrap(36, s);
const magenta = (s: string) => wrap(35, s);

/* --------------------------------- entry ---------------------------------- */

/**
 * Read piped stdin without hanging when there is no pipe (some non-TTY
 * hosts keep fd 0 open indefinitely). We resolve on `end`, with a short
 * timeout fallback that also flushes whatever data already arrived.
 */
function readStdin(timeoutMs = 120): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", () => finish(data));
    process.stdin.resume();
  });
}

readStdin().then((stdin) =>
  main(process.argv.slice(2), stdin).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(red(`error: ${(err as Error)?.message ?? err}\n`));
      process.exit(1);
    },
  ),
);

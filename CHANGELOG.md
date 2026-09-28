# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-28

First public release.

### Added

- Universal typed decision API: `choose`/`classify`, `yesno`, `score`, `rank`.
- Providers:
  - `heuristic` — offline multilingual lexical engine with label semantics,
    urgency ranking, PII/secret signals and a fail-closed `safety` yes/no mode.
  - `mock` — deterministic seeded decisions for tests and CI.
  - `jev` — TypeSafe AI Jev cloud preset (`JEV_API_KEY` / `JEV_BASE_URL`).
  - `selfhosted` — preset for any Decide Wire Protocol endpoint serving open
    decision weights (Laya/von/tev1/…).
- `HttpProvider` with lenient response normalization, bearer auth and timeouts.
- Client middleware: TTL cache, call/cost budgets, ordered fallback chain with
  `degraded`/`attempted` telemetry.
- `decide` CLI: `classify`, `choose`, `yesno`, `score`, `rank`, `providers`,
  `bench`; human-readable bars and `--json` output; stdin piping.
- Zero-dependency browser Playground (`playground/index.html`).
- Decide Wire Protocol specification (English README).
- 39 offline tests, strict TypeScript, ESM + CJS dual build with types.
- GitHub Actions CI on Node 18/20/22, Ubuntu and Windows.

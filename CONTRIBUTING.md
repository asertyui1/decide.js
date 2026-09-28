# Contributing to Decide.js

Thanks for your interest in improving Decide.js! This project aims to stay
small, dependency-free at runtime, and easy to vendor into any agent stack.

## Development

```bash
git clone https://github.com/asertyui1/decide.js
cd decide.js
npm install
npm test          # vitest, runs in seconds, fully offline
npm run typecheck # strict TypeScript
npm run build     # tsup -> dist/
npm run cli -- providers
```

The whole test suite runs without network access — please keep it that way.

## Project layout

```
src/
  types.ts            # the public decision protocol (request/response types)
  errors.ts           # typed error hierarchy
  hash.ts text.ts     # dependency-free primitives
  client.ts           # validation, fallback chain, cache, budget, timing
  middleware.ts       # DecisionCache + Budget
  providers/
    mock.ts           # deterministic offline decisions
    heuristic.ts      # explainable local lexical engine
    http.ts           # Decide Wire Protocol adapter + lenient normalization
    jev.ts           # jev / self-hosted presets
  cli/index.ts        # the `decide` command
tests/                # vitest (providers, client, http e2e, CLI subprocess)
examples/             # runnable scenario demos
playground/           # zero-dependency browser page
```

## Before opening a PR

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes — add tests for new behavior (the CLI has subprocess tests)
- [ ] New providers implement `DecisionProvider` and register without breaking
      the offline guarantee (no API key may be required for the default path)
- [ ] Public API changes update both README files and the type doc comments
- [ ] Keep runtime dependencies at zero; devDependencies are fine

## Adding a provider

1. Reuse `HttpProvider` if your backend speaks the Decide Wire Protocol.
2. For something bespoke, implement `DecisionProvider` (`name`, `capabilities`,
   `isAvailable()`, `decide()`) — see `src/providers/mock.ts` for the minimal shape.
3. Register it in `builtinProviders()` or document direct instantiation.
4. Add an example and tests with a local HTTP fixture (never hit real APIs in CI).

## Adding label signals to the heuristic provider

The heuristic engine uses transparent, auditable keyword signals
(`LABEL_SIGNALS` in `src/providers/heuristic.ts`). When adding signals:

- Prefer high-precision phrases over single ambiguous words.
- Add both English and Chinese coverage where the concept is cross-lingual.
- Add a regression test in `tests/providers.test.ts` proving the new case and
  checking a plausible negative case (no crying wolf).

## Conduct

Be kind, technical, and specific. Issues should include reproduction steps and
the output of `decide providers --json`.

# linear-cli

Agent-native CLI for Linear. Deno + Cliffy + @linear/sdk.

**Full spec:** `.context/SPEC.md` — all commands, flags, output formats, error handling, build sequence.

## Dev

```
deno task dev -- issue list
deno task dev -- issue list --format compact
```

## Compile

```
deno task compile
```

## Architecture

- `src/commands/` — Cliffy command definitions. One file per entity.
- `src/client.ts` — LinearClient wrapper via `@linear/sdk`. Commands use SDK methods directly.
- `src/output/` — Formatters (table + compact + json). Commands return data, formatters render.
- `src/config.ts` — Config loading: global → project → env → flags (TOML).
- `src/auth.ts` — Credential read/write (`~/.config/linear/credentials.toml`).
- `src/resolve.ts` — Name resolution (exact match → substring → ambiguity error with emails).

## Conventions

- Commands never print data directly. Always use `render()`.
- Short identifiers (`POL-5`) everywhere. Never expose UUIDs except in `--format json`.
- Errors to stderr with `error:` prefix + `try:` hint line. Data to stdout.
- Exit codes: 0=success, 1=general, 2=auth, 3=not found, 4=validation.
- SDK handles all API interaction. No raw GraphQL queries.
- `@linear/sdk` via `npm:` specifier — SDK encodes behavioral contract (null→undefined coercion, lazy fetching, Relay pagination) that raw schema can't express.

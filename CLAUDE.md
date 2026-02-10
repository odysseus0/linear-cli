# linear-cli

Agent-native CLI for Linear. Deno + Cliffy + @linear/sdk.

**Behavioral spec:** `.context/SPEC.md` — commands, flags, output formats, error
handling.

## Dev

```
deno task dev -- auth status
deno task dev -- team list --format json
deno task check
```

## Conventions

- Commands never print data directly. Always use `render()` / `renderMessage()`.
- Short identifiers (`POL-5`) everywhere. Never expose UUIDs except in
  `--format json`.
- Errors to stderr with `error:` prefix + `try:` hint line. Data to stdout.
- Exit codes: 0=success, 1=general, 2=auth, 3=not found, 4=validation.
- Global options (`--format`, `--team`) extracted via `getFormat()` from
  `types.ts` — Cliffy doesn't propagate global option types to subcommand files,
  so this is the one centralized cast.

## SDK Patterns

`@linear/sdk` via `npm:` specifier. The SDK encodes a behavioral contract that
raw GraphQL can't express:

- **Null → undefined coercion** — SDK's custom codegen converts nullable fields
  to `undefined`, preventing "explicit null breaks API" issues
- **Lazy fetching** — `issue.assignee` returns a `LinearFetch<User>` that only
  hits the API when awaited. Use for detail views; list views have eager scalar
  fields already loaded.
- **Relay pagination** — `connection.nodes` for data, `connection.fetchNext()`
  to paginate
- **Internal field filtering** — fields marked `[Internal]` or `[ALPHA]`
  excluded

Common patterns:

```typescript
// List with filter
const issues = await client.issues({ filter: { team: { key: { eq: "POL" } } }, first: 50 })
for (const issue of issues.nodes) { ... }

// Detail with lazy relations
const issue = await client.issue(id)
const assignee = await issue.assignee  // separate API call, only when needed
const comments = await issue.comments()

// Create
await client.createIssue({ teamId, title, description, assigneeId, ... })
```

## Agent Usability Testing

`scenarios/` — test harness for measuring CLI usability by zero-context agents.
Spawn one agent per scenario, agent must figure out CLI from `--help` alone.

**Current target:** Discoverability — can the agent complete the task at all?
Run with: feed `scenarios/run-agent-test.md` as prompt to a Claude session.

**Future sprint:** Efficiency — minimize turns per scenario. Same scenarios, but
optimize CLI design (aliases, richer help, guessable verbs) to reduce discovery
chain. Baseline from first run: close-issue = 4 turns (theoretical minimum for
current help structure). Run 2 (guess-first prompt): 5/6 first-guess success,
mean 1.2 turns. `--status` alias added after finding agents guess it over `--state`.

**Future: Batch operations.** Variadic args on `delete` and `update` — e.g.,
`issue delete POL-1 POL-2 POL-3`. Delete is client-side loop (`issueArchive`
per issue), update can use SDK's `issueBatchUpdate` for single API call.

## Release

`deno compile` produces standalone binaries (embeds Deno runtime). Distribution:

- GitHub releases: binaries for darwin-arm64, darwin-x64, linux-x64
- Homebrew: `odysseus0/tap/linear-cli` with prebuilt binaries
- GitHub Actions on tag push (`v*`) triggers compile + release

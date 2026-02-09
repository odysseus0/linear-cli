# linear-cli: Agent-Native CLI for Linear

## Context

Linear's official MCP server returns unoptimized JSON that burns thousands of tokens per call. The existing `schpet/linear-cli` (Deno/TypeScript) uses 109 hand-written GraphQL queries instead of Linear's SDK, and is IC-biased (defaults to `--assignee me`, git branch workflows). Neither tool is designed for AI agent consumption.

linear-cli is a Deno/TypeScript CLI for Linear built for AI agents managing work. Uses the official `@linear/sdk` for API interaction (correctness, lazy fetching, null handling, pagination all handled by the SDK's custom codegen). Cliffy for Cobra-level CLI framework (subcommands, completions, help, prompts, tables — all built in). Adds orchestrator-first defaults and token-efficient output formatting.

**Primary use case:** Claude Code (and similar AI coding agents) managing teams and issues in Linear as part of an agent orchestration workflow.

**Repo:** `odysseus0/linear-cli`

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Deno | Built-in TS, permissions model, `deno compile` for single binary |
| CLI framework | Cliffy (`@cliffy/command`) | Cobra-equivalent for TS. Subcommands, shell completions, help, prompts, table, ANSI — all built in. |
| Linear API | `npm:@linear/sdk` | Official SDK via Deno npm compat. Custom codegen handles behavioral contract (null→undefined, lazy fetch, pagination, skip internal fields). No raw GraphQL needed. |
| Terminal rendering | Cliffy built-in (`@cliffy/table`, `@cliffy/ansi`) | Colors, column alignment, no extra deps |
| Auth storage | TOML at `~/.config/linear/credentials.toml` | Compatible with schpet/linear-cli credentials |
| Config | `@std/toml` | Deno stdlib TOML parsing. Global + project-level config |
| Release | `deno compile` + GitHub releases | Cross-platform binaries, Homebrew tap |

## Architecture

```
linear-cli/
├── src/

│   ├── main.ts                    # Entry point, Cliffy command tree
│   ├── client.ts                  # LinearClient init (SDK + auth)
│   ├── commands/                  # One file per entity
│   │   ├── auth.ts                # auth login/logout/status/whoami
│   │   ├── issue.ts               # issue list/create/view/update/delete + comment
│   │   ├── team.ts                # team list/view/members/overview
│   │   ├── project.ts             # project list/view/create
│   │   └── cycle.ts               # cycle list/view
│   ├── output/
│   │   ├── formatter.ts           # Format dispatch (table vs compact)
│   │   ├── table.ts               # Colored table output (Cliffy Table + ANSI)
│   │   └── compact.ts             # Tab-delimited output for agents
│   ├── config.ts                  # Config loading: flags → env → project → global → defaults
│   ├── auth.ts                    # Credential read/write (TOML via @std/toml)
│   └── resolve.ts                 # Name resolution (users, labels, projects)
├── deno.json                      # Deno config, imports, tasks
├── deno.lock
├── CLAUDE.md                      # AI maintainer instructions
├── SPEC.md                        # This file
├── README.md
└── LICENSE                        # MIT
```

### Design Principles

1. **Commands return data, formatters render.** No `console.log` in command handlers. Commands populate a result struct, pass to `render()`.

2. **Orchestrator-first defaults.** All assignees, all active states, sort by updated. Override with flags to narrow.

3. **Short identifiers everywhere.** Accept `POL-5` and UUIDs as input. Only output `POL-5` style identifiers. Never expose UUIDs to the user.

4. **Errors to stderr, data to stdout.** `--format` flag only affects stdout. Errors are always plain text on stderr with consistent prefix: `error: <message>`. Errors include a `try:` hint line when actionable recovery info is available — the hint should contain enough for the caller to construct a correct retry without a separate query.

5. **Exit codes are semantic.** 0=success, 1=general error, 2=auth error, 3=not found, 4=validation/ambiguity error.

6. **Stdin for long content.** When `--description` is not provided and stdin is not a TTY, read stdin as description. Same pattern as `git commit` without `-m`.

---

## Global Flags

Available on every command:

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--format` | `-f` | Auto-detect | Output format: `table`, `compact`, or `json`. Default: `table` if stdout is TTY, `compact` if piped. |
| `--team` | `-t` | From config | Team key (e.g. `POL`). Overrides config default |
| `--workspace` | `-w` | From config | Workspace slug. For future multi-workspace support |
| `--help` | `-h` | | Show help |
| `--version` | `-v` | | Show version |

### Output Formats

**Format auto-detection:** `Deno.stdout.isTerminal()` — TTY defaults to `table`, pipe defaults to `compact`. `--format` overrides. Agents never need to remember `--format compact`.

**`table`** (default when TTY) — Human-friendly colored tables:
```
◌   ID     STATE    ASSIGNEE  TITLE                   UPDATED
--- POL-6  Backlog  -         Test issue from MCP     1 min ago
--- POL-5  Backlog  -         Test issue from CLI     1 min ago
!!! POL-1  Todo     Alice     Implement auth module   2 hours ago
```

Priority indicators: `!!!` urgent, `!!` high, `!` medium, `---` none/low. State names colored by their Linear color. Relative timestamps.

**`compact`** (default when piped) — Tab-delimited with header row for agents:
```
ID	STATE	ASSIGNEE	TITLE	UPDATED
POL-6	Backlog	-	Test issue from MCP	1m
POL-5	Backlog	-	Test issue from CLI	1m
POL-1	Todo	Alice	Implement auth module	2h
```

No colors, no decorations, minimal timestamps (`1m`, `2h`, `3d`). One header row, then data. Tab-delimited for `cut -f` compatibility.

**`json`** — Full structured data, escape hatch for programmatic use:
```json
[
  {"id": "POL-6", "state": "Backlog", "assignee": null, "title": "Test issue from MCP", "updatedAt": "2026-02-08T21:16:37Z"},
  {"id": "POL-1", "state": "Todo", "assignee": "Alice", "title": "Implement auth module", "updatedAt": "2026-02-08T19:00:00Z"}
]
```

JSON output includes UUIDs alongside short identifiers so consumers can round-trip data back to the CLI (which accepts both `POL-5` and UUIDs as input).

---

## Config System

**Precedence (highest wins):** CLI flags → environment variables → project config → global config → defaults

### Credential File

`~/.config/linear/credentials.toml`:
```toml
default = "polytropos"
polytropos = "lin_api_xxxxx"
```

Multi-workspace ready from day one. Single workspace to start — just one entry plus `default` key.

### Global Config

`~/.config/linear/config.toml`:
```toml
default_team = "POL"
default_format = "table"
```

### Project Config

`.linear.toml` in cwd or git root:
```toml
team = "POL"
```

### Environment Variables

| Variable | Maps to |
|----------|---------|
| `LINEAR_API_KEY` | API key (overrides credentials.toml) |
| `LINEAR_TEAM` | Default team |
| `LINEAR_FORMAT` | Default format |

---

## Commands — Phase 1

### `linear-cli` (root, no subcommand)

Shows curated help with common commands and examples:

```
linear-cli — Agent-native Linear CLI

Usage:
  linear-cli [command]

Common Commands:
  issue list          List issues (all assignees, sorted by updated)
  issue create        Create a new issue
  issue view POL-5    View issue details
  team overview       Team status dashboard

All Commands:
  auth                Manage authentication
  issue               Manage issues
  team                Manage teams
  project             Manage projects
  cycle               Manage cycles

Flags:
  -f, --format string   Output format: table, compact, json (default "table")
  -t, --team string     Team key (default from config)
  -h, --help            Show help
  -v, --version         Show version

Use "linear-cli [command] --help" for more information about a command.
```

---

### `linear-cli auth login`

Authenticate with Linear.

**Behavior:**
1. If `--key` provided, use it directly
2. If `LINEAR_API_KEY` env var set, use it
3. Otherwise, prompt interactively: "Enter your Linear API key (create at https://linear.app/settings/api):"
4. Validate key by calling `client.viewer`
5. Save to `~/.config/linear/credentials.toml` with workspace slug as key
6. Print: `Authenticated as <name> in workspace <workspace>`

**Flags:**

| Flag | Description |
|------|-------------|
| `--key <key>` | API key (non-interactive) |

**Exit codes:** 0 success, 2 invalid key, 1 other error

---

### `linear-cli auth logout`

Remove stored credentials.

**Behavior:** Remove the current workspace's entry from credentials.toml. If it was the default, set default to next available workspace or clear.

**Output:** `Logged out of workspace <workspace>`

---

### `linear-cli auth status`

Show current authentication status.

**Output (authenticated):**
```
Authenticated as George Zhang (george@example.com)
Workspace: polytropos
```

**Output (not authenticated):**
```
error: not authenticated. Run 'linear-cli auth login' first.
```
Exit code 2.

---

### `linear-cli auth whoami`

Print current user info. Shortcut for `auth status` that's more detailed.

**Table output:**
```
NAME           EMAIL                ADMIN  ACTIVE
George Zhang   george@example.com   yes    yes
```

---

### `linear-cli issue list`

List issues. Orchestrator-first defaults: all assignees, all active states, sorted by updated.

**Flags:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--state <state>` | `-s` | All active | Filter by state type: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`. Repeatable. |
| `--assignee <name>` | `-a` | All | Filter by assignee name or "me" |
| `--unassigned` | `-U` | false | Show only unassigned issues |
| `--label <name>` | `-l` | | Filter by label. Repeatable. Multiple = AND (all must match). |
| `--project <name>` | `-p` | | Filter by project name |
| `--sort <field>` | | `updatedAt` | Sort: `updatedAt`, `createdAt`, `priority` |
| `--limit <n>` | | 50 | Max results. 0 = unlimited |
| `--include-completed` | | false | Include completed and canceled issues |

**Default behavior (no flags):** Shows all issues in triage, backlog, unstarted, and started states, for all assignees on the configured team, sorted by most recently updated. This is the "what's active right now" view.

**Table output:**
```
◌   ID     STATE        ASSIGNEE  TITLE                       UPDATED
!!! POL-7  In Progress  Alice     Fix auth race condition     5 min ago
--- POL-6  Backlog      -         Test issue from MCP         1 hour ago
--- POL-5  Backlog      -         Test issue from CLI         1 hour ago
```

**Compact output:**
```
ID	STATE	ASSIGNEE	TITLE	UPDATED
POL-7	In Progress	Alice	Fix auth race condition	5m
POL-6	Backlog	-	Test issue from MCP	1h
POL-5	Backlog	-	Test issue from CLI	1h
```

**SDK:** `client.issues({ filter: { team, state, assignee, labels }, first: 50, orderBy: PaginationOrderBy.UpdatedAt })`

---

### `linear-cli issue create`

Create a new issue.

**Flags:**

| Flag | Short | Required | Description |
|------|-------|----------|-------------|
| `--title <title>` | | Yes | Issue title |
| `--description <desc>` | `-d` | No | Issue description. If omitted and stdin is not a TTY, read from stdin. |
| `--assignee <name>` | `-a` | No | Assignee name or "me" |
| `--state <state>` | `-s` | No | Initial state name (default: team's default state) |
| `--priority <n>` | | No | Priority: 1=urgent, 2=high, 3=medium, 4=low |
| `--label <name>` | `-l` | No | Label name. Repeatable. |
| `--project <name>` | `-p` | No | Project name |
| `--parent <id>` | | No | Parent issue identifier (e.g. POL-5) for sub-issues |

**Behavior:**
1. Resolve team from `--team` flag or config
2. If `--description` not set and stdin is not a TTY, read stdin as description
3. Resolve assignee name to user ID via `resolve.ts`
4. Resolve label names to label IDs via `resolve.ts`
5. Create issue via `client.createIssue()`
6. Print the created issue (using current format)

**Table output:**
```
Created POL-8: Fix auth race condition
https://linear.app/polytropos/issue/POL-8/fix-auth-race-condition
```

**Compact output:**
```
POL-8	Backlog	Alice	Fix auth race condition	just now
```

**Stdin example:**
```bash
echo "This is a detailed description with **markdown** support." | linear-cli issue create --title "New feature"
```

---

### `linear-cli issue view <id>`

View full issue details.

**Argument:** Issue identifier (e.g. `POL-5`) or UUID.

**Table output:**
```
POL-5: Test issue from CLI
━━━━━━━━━━━━━━━━━━━━━━━━━━━

State:       Backlog
Priority:    None
Assignee:    -
Labels:      -
Project:     -
Cycle:       -
Created:     2026-02-08 (1 hour ago)
Updated:     2026-02-08 (1 hour ago)
URL:         https://linear.app/polytropos/issue/POL-5/test-issue-from-cli

Description:
Comparing CLI vs MCP output

Comments (2):
  Alice (5 min ago): Looks good, let's ship it.
  George (2 min ago): Agreed.
```

**Compact output:** Key-value pairs, one per line:
```
id	POL-5
title	Test issue from CLI
state	Backlog
priority	None
assignee	-
labels	-
project	-
cycle	-
created	2026-02-08T21:16:37Z
updated	2026-02-08T21:16:37Z
url	https://linear.app/polytropos/issue/POL-5/test-issue-from-cli
description	Comparing CLI vs MCP output
```

**SDK:** `client.issue(id)` — returns full issue. Lazy-load relations: `await issue.assignee`, `await issue.project`, `await issue.comments()`. SDK handles all field selection.

---

### `linear-cli issue update <id>`

Update issue fields. Only specified flags are changed; unspecified fields are left untouched.

**Argument:** Issue identifier.

**Flags:**

| Flag | Description |
|------|-------------|
| `--title <title>` | New title |
| `--description <desc>` | New description. Stdin supported (same rules as create). |
| `--assignee <name>` | New assignee. Use "" to unassign. |
| `--state <state>` | New state name |
| `--priority <n>` | New priority (1-4) |
| `--label <name>` | Replace all labels. Repeatable. |
| `--add-label <name>` | Add a label without removing existing. Repeatable. |
| `--remove-label <name>` | Remove a label. Repeatable. |
| `--project <name>` | Move to project |
| `--parent <id>` | Set parent issue |

**Behavior:**
1. Resolve names to IDs (assignee, labels, project)
2. For label operations: fetch current labels, compute delta, send full label ID list
3. Call `client.updateIssue(id, input)` with changed fields only
4. Print updated issue summary

**Output:** Same as `issue view` for the updated issue.

---

### `linear-cli issue delete <id>`

Delete an issue.

**Argument:** Issue identifier.

**Behavior:**
1. If stdin is a TTY, prompt: `Delete POL-5 "Test issue"? [y/N]`
2. If stdin is not a TTY (agent use), delete without confirmation
3. Call `client.archiveIssue(id)` (Linear doesn't truly delete, it archives)

**Output:** `Deleted POL-5: Test issue from CLI`

---

### `linear-cli issue comment list <id>`

List comments on an issue.

**Argument:** Issue identifier.

**Table output:**
```
AUTHOR         AGE        BODY
Alice          5 min ago  Looks good, let's ship it.
George         2 min ago  Agreed.
```

**Compact output:**
```
AUTHOR	AGE	BODY
Alice	5m	Looks good, let's ship it.
George	2m	Agreed.
```

---

### `linear-cli issue comment add <id>`

Add a comment to an issue.

**Argument:** Issue identifier.

**Flags:**

| Flag | Description |
|------|-------------|
| `--body <text>` | Comment text. If omitted and stdin is not a TTY, read from stdin. |

**Output:** `Comment added to POL-5`

---

### `linear-cli team list`

List all teams.

**Table output:**
```
KEY  NAME         ISSUES  CYCLES
POL  Polytropos   6       No
ENG  Engineering  142     Yes
```

**Compact output:**
```
KEY	NAME	ISSUES	CYCLES
POL	Polytropos	6	No
ENG	Engineering	142	Yes
```

---

### `linear-cli team view <key>`

View team details.

**Argument:** Team key (e.g. `POL`).

**Table output:**
```
Polytropos (POL)
━━━━━━━━━━━━━━━━

Description:  Main workspace team
Issues:       6
Cycles:       Disabled
Members:      1
Created:      2026-02-08
```

---

### `linear-cli team members <key>`

List team members.

**Argument:** Team key.

**Table output:**
```
NAME           EMAIL                ADMIN  ACTIVE
George Zhang   george@example.com   yes    yes
```

---

### `linear-cli team overview`

Team status dashboard. The orchestrator's primary command.

**Behavior:** Fetch all active issues for the team, group by assignee × state type, display as matrix.

**Uses `--team` flag or config default.**

**Table output:**
```
Polytropos (POL) — Overview

             Backlog  Todo  In Progress  Done
George       2        1     3            5
Bot-1        0        4     1            2
Bot-2        1        2     0            3
Unassigned   3        0     0            0

Total: 27 issues | 4 in progress | 10 done
```

**Compact output:**
```
ASSIGNEE	BACKLOG	TODO	IN_PROGRESS	DONE
George	2	1	3	5
Bot-1	0	4	1	2
Bot-2	1	2	0	3
Unassigned	3	0	0	0
```

**SDK:** Fetch all issues via `client.issues({ filter: { team } })`, paginate with `fetchNext()`, group client-side by assignee and state type.

---

### `linear-cli project list`

List projects.

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--state <state>` | All active | Filter: `planned`, `started`, `paused`, `completed`, `canceled` |
| `--include-completed` | false | Include completed/canceled |

**Table output:**
```
NAME              STATE    PROGRESS  LEAD    TARGET
Auth System       Started  45%       Alice   2026-03-01
API Redesign      Planned  0%        -       2026-04-15
```

**Compact output:**
```
NAME	STATE	PROGRESS	LEAD	TARGET
Auth System	Started	45%	Alice	2026-03-01
API Redesign	Planned	0%	-	2026-04-15
```

---

### `linear-cli project view <id>`

View project details.

**Argument:** Project name or ID.

**Table output:**
```
Auth System
━━━━━━━━━━━

State:       Started
Progress:    45% (9/20 issues)
Lead:        Alice
Target:      2026-03-01
Teams:       POL
Created:     2026-01-15
URL:         https://linear.app/polytropos/project/auth-system

Recent Issues:
  POL-7  In Progress  Alice  Fix auth race condition    5 min ago
  POL-3  Todo         Bob    Add OAuth provider         1 day ago
```

---

### `linear-cli project create`

Create a new project.

**Flags:**

| Flag | Required | Description |
|------|----------|-------------|
| `--name <name>` | Yes | Project name |
| `--description <desc>` | No | Description. Stdin supported. |
| `--lead <name>` | No | Project lead |
| `--target-date <date>` | No | Target completion date (YYYY-MM-DD) |

**Output:** `Created project: Auth System` + URL

---

### `linear-cli cycle list`

List cycles for a team. This fills the gap that the Deno CLI and MCP both miss.

**Table output:**
```
#   NAME       STARTS      ENDS        PROGRESS
12  Sprint 12  2026-02-03  2026-02-17  35%
13  Sprint 13  2026-02-17  2026-03-03  0%
```

**Compact output:**
```
NUMBER	NAME	STARTS	ENDS	PROGRESS
12	Sprint 12	2026-02-03	2026-02-17	35%
13	Sprint 13	2026-02-17	2026-03-03	0%
```

---

### `linear-cli cycle view <number>`

View cycle details with its issues.

**Argument:** Cycle number (e.g. `12`).

**Table output:**
```
Sprint 12 (#12)
━━━━━━━━━━━━━━━

Period:     2026-02-03 → 2026-02-17
Progress:   35% (7/20 issues)

Issues:
  POL-7  In Progress  Alice  Fix auth race condition    5 min ago
  POL-3  Todo         Bob    Add OAuth provider         1 day ago
  ...
```

---

## SDK Usage

### Client: `src/client.ts`

Initialize `LinearClient` from the SDK with the API key from auth. The SDK handles all GraphQL, null coercion, lazy fetching, and pagination internally.

```typescript
import { LinearClient } from "npm:@linear/sdk";

export function createClient(apiKey: string): LinearClient {
  return new LinearClient({ apiKey });
}
```

Commands call SDK methods directly:
- `client.issues({ filter, first: 50, orderBy: PaginationOrderBy.UpdatedAt })`
- `client.createIssue({ teamId, title, ... })`
- `client.issue(id)` — returns full issue with lazy-loaded relations

The SDK's lazy fetching means `issue.assignee` returns a `LinearFetch<User>` that only hits the API when awaited. Use this for detail views; for list views, the eager scalar fields (identifier, title, priority, updatedAt) are already loaded.

### What the SDK handles (so we don't have to)

- **Null → undefined coercion** — SDK's custom codegen converts nullable fields to `undefined`, preventing the "explicit null breaks API" problem
- **Lazy fetching** — nested objects (assignee, project, cycle) store only IDs; full data fetched on demand
- **Relay pagination** — `connection.fetchNext()`, `connection.nodes`, `connection.pageInfo`
- **Internal field filtering** — fields marked `[Internal]` or `[ALPHA]` excluded from SDK

---

## Output System

### `src/output/formatter.ts`

```typescript
type Format = "table" | "compact" | "json";

interface TableData {
  headers: string[];
  rows: string[][];
}

interface DetailData {
  title: string;
  fields: { label: string; value: string }[];
  sections?: { title: string; table: TableData }[];
}

function render(format: Format, data: TableData | DetailData): void;
function renderJson(data: unknown): void; // JSON.stringify(data, null, 2)
function renderMessage(format: Format, msg: string): void;
```

Commands return data structs, formatters render. No `console.log` in command handlers.

### Table formatter (Cliffy Table + ANSI)

- Headers: bold, cyan
- Priority: `!!!` red, `!!` orange, `!` yellow, `---` dim
- State colors: mapped from Linear's hex color for each state
- Timestamps: relative ("5 min ago", "2 hours ago", "3 days ago")
- Uses `@cliffy/table` for column alignment, `@cliffy/ansi` for colors

### Compact formatter

- Tab-delimited
- First row: headers (uppercase)
- No colors, no ANSI codes
- Timestamps: abbreviated (`5m`, `2h`, `3d`)
- Null/empty values: `-`

---

## Auth System

### `src/auth.ts`

Credentials stored at `~/.config/linear/credentials.toml`:

```toml
default = "polytropos"
polytropos = "lin_api_xxxxx"
```

Functions needed:
- `loadCredentials(): Record<string, string> + default`
- `saveCredentials(workspace: string, apiKey: string)`
- `getAPIKey(workspace?: string): string` (uses default if workspace empty)
- `removeCredentials(workspace: string)`
- `credentialsPath(): string` (XDG-compliant)

### Auth resolution order

1. `LINEAR_API_KEY` environment variable
2. `--key` flag (on `auth login` only)
3. Credentials TOML (default workspace, or `--workspace` if specified)

**Conflict detection:** If both `LINEAR_API_KEY` and `--workspace` are set, error with exit code 4. These are contradictory — env var bypasses the credential file entirely, so a workspace selection is meaningless.

---

## Error Handling

One error class, one top-level catch. Cliffy handles CLI validation (missing flags, wrong types, unknown commands). We handle domain errors (not found, ambiguous, auth).

```typescript
class CliError extends Error {
  constructor(message: string, public code = 1, public hint?: string) {
    super(message)
  }
}
```

Top-level catch in `main.ts`:
```typescript
try {
  await app.parse(Deno.args)
} catch (e) {
  if (e instanceof CliError) {
    console.error(`error: ${e.message}`)
    if (e.hint) console.error(`  try: ${e.hint}`)
    Deno.exit(e.code)
  }
  throw e // let Cliffy's own errors bubble
}
```

Error scenarios and hints:

| Scenario | Exit | Hint |
|----------|------|------|
| Not authenticated | 2 | `run 'linear-cli auth login'` |
| Invalid API key | 2 | `check your API key at linear.app/settings/api` |
| Issue not found: POL-99 | 3 | (none) |
| User not found: "bob" | 3 | `available: Alice (alice@co.com), George (george@co.com)` |
| Ambiguous user: "al" | 4 | `matches: Alice (alice@co.com), Alan (alan@co.com)` |
| Team not found: "FOO" | 3 | `available: POL, ENG` |
| No team specified | 4 | `use --team or set default_team in config` |
| LINEAR_API_KEY + --workspace both set | 4 | `use one or the other, not both` |

The hint contains candidates from the failed resolution — no extra API call needed since the resolver already has them in scope.

---

## Name Resolution

Several commands accept human-friendly names that must be resolved to Linear IDs:

- **Assignee:** `--assignee Alice` → fetch users, find by name match (case-insensitive substring), get ID
- **Labels:** `--label bug` → fetch team labels, find by name match, get ID
- **Projects:** `--project "Auth System"` → fetch projects, find by name match, get ID
- **Teams:** `--team POL` → the team key IS the identifier (no resolution needed)

Resolution functions live in `src/resolve.ts`, separate from command logic. Uses SDK's `client.users()`, `client.issueLabels()`, `client.projects()` for lookups.

Resolution strategy: exact match (case-insensitive) → substring match → error with candidates.

If one substring match: use it (no ambiguity).

If multiple substring matches:
```
error: ambiguous user "al"
  try: Alice (alice@co.com), Alan (alan@co.com)
```

If zero matches:
```
error: user not found: "bob"
  try: Alice (alice@co.com), George (george@co.com)
```

Candidates come from the same query that failed — no extra API call.

### Identifier Resolution

All commands that accept issue/project identifiers detect format by shape:
- `POL-5` → identifier lookup (uppercase, prepend team key if numeric only)
- `550e8400-e29b-41d4-...` → UUID, pass directly to SDK
- UUIDs accepted as input (for round-tripping from `--format json`) but never output in `table` or `compact` formats

---

## Deno Tasks

In `deno.json`. Use latest versions for all dependencies:

- **Cliffy:** `@cliffy/command`, `@cliffy/table`, `@cliffy/ansi`, `@cliffy/prompt` from JSR
- **Deno stdlib:** `@std/toml`, `@std/fs`, `@std/path` from JSR
- **Linear SDK:** `npm:@linear/sdk`

---

## Testing Strategy

**Unit tests:** Output formatting (table and compact renderers). Given `TableData`, verify output string. No network calls. Uses `deno test`.

**Integration tests:** Via `--integration` flag. Run against real Linear API (Polytropos workspace). Test happy path of each command. Use a `_test` label on created issues for cleanup.

**Smoke test script:** `test/smoke.sh` that runs each command and checks exit code + output is non-empty.

---

## Build Sequence

Execute in this order. Each step validates the previous.

1. **Init repo:** `deno init`, set up `deno.json` with imports (Cliffy, @linear/sdk, @std/toml)
2. **Auth:** Implement `src/auth.ts` — read existing credentials.toml via @std/toml
3. **Client:** Implement `src/client.ts` — LinearClient from SDK
4. **Output:** Implement formatters — table (Cliffy Table) + compact
5. **Root + Auth commands:** `src/main.ts` + `src/commands/auth.ts` — verify auth works
6. **Team commands:** `src/commands/team.ts` — list, view, members. **First full stack validation.**
7. **Issue commands:** `src/commands/issue.ts` — list, create, view, update, delete, comment
8. **Project commands:** `src/commands/project.ts` — list, view, create
9. **Cycle commands:** `src/commands/cycle.ts` — list, view
10. **Team overview:** Add overview subcommand with aggregation logic
11. **Name resolution:** `src/resolve.ts` — exact match → substring → ambiguity errors
12. **Polish:** Help text, error messages, edge cases, shell completions
13. **Compile + README**
14. **Tests:** Unit tests for output, integration smoke tests

---

## Release Setup

### `deno compile`

Produces standalone binaries per platform (embeds Deno runtime). Distribute via:
- GitHub releases: binaries for darwin-arm64, darwin-x64, linux-x64
- Homebrew: tap with prebuilt binaries from GitHub releases
- JSR: `deno install` from JSR registry

### GitHub Actions: `.github/workflows/release.yml`

Trigger on tag push (`v*`). Runs `deno compile` for each target, creates GitHub release.
